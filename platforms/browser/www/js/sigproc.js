/**
 * Created by n8 on 4/2/17.
 */

var watchID = null;
var eventTag = false;

// Motion variables
var signalIds = ["xacc", "yacc", "zacc"];
var t = []; // Variable for holding phone times
var events = []; // Variable for holding event indicators
var accdata = {xacc: [], yacc: [], zacc: []};
var unfilteredData = {xacc: [], yacc: [], zacc: []};
var freqOrder = 6;
var freqs = math.pow(2, freqOrder);
var hfreqs = freqs/2;
var stride = 4;
var accspectrograms = {xacc: [], yacc: [], zacc:[]};
var chartTitles = {xacc: 'x', yacc: 'y', zacc: 'z'};
var xVal = 0;
var strideDelay = 0;
var dataLength = 101; // number of dataPoints visible at any point
var hFIR = [1, 0, 0, 0, 0, 0]; // filter impulse response

var stockInfo = null;
var stockInfo2 = null;
var dwtInfo = null;
var dwtInfo2 = null;

// Dropbox variables
var DROPBOX_APP_KEY = 'vbbxdkgrcja2cks';
var client = new Dropbox.Client({key: DROPBOX_APP_KEY});
client.authDriver(new Dropbox.AuthDriver.Cordova());

// c3 Charts
var chart = null;
var ocChart = null;
var hlChart = null;
var volChart = null;
var dwtChart = null;

// d3 Chart
var xScale = null;
var yScale = null;
var svg = {xacc: null, yacc: null, zacc: null};;
var row = null;
var col = null;
var colorLow = 'blue', colorMed = 'white', colorHigh = 'red';
var colorScale = d3.scale.linear()
    .domain([0, 20])
    .range([colorMed, colorHigh]);

var margin = {top: 20, right: 20, bottom: 20, left: 20},
    width = 300 - margin.left - margin.right,
    height = 300 - margin.top - margin.bottom;


var getTime = function() {
    return Date.now();
}

function updateFilter(i, v) {
    hFIR[i] = v;
}

function transpose(a)
{
    return a[0].map(function (_, c) { return a.map(function (r) { return r[c]; }); });
}

function real2complex(x) {
    return x.map(function(e) {
        return [e, 0];
    });
}

function phaseShift (x) {
    var n = x.length;
    var f = math.pi / n;
    return x.map(function(e, i){
        var th = f*i;
        var c = math.cos(th)
        var s = math.sin(th)
        return [e[0]*c+e[1]*s, -e[0]*s+e[1]*c];
    });

}

function entrywiseComplexAdd (x, y) {
    return x.map(function(e, i){
        return [e[0]+y[i][0], e[1]+y[i][1]];
    });
}

function entrywiseComplexSubtract (x, y) {
    return x.map(function(e, i){
        return [e[0]-y[i][0], e[1]-y[i][1]];
    });
}

function entrywiseComplexRealScalarMultiply (a, x) {
    return x.map(function(e,i){
        return [a*e[0], a*e[1]];
    });
}

function entrywiseComplexMultiply (x, y) {
    return x.map(function(e,i){
        var c1 = e[0]*(y[i][0]+y[i][1]);
        var c2 = y[i][1]*(e[0]+e[1]);
        var c3 = y[i][0]*(e[1]-e[0]);
        return [c1-c2, c1+c3];
    });
}

function entrywiseComplexAbsolute (x) {
    return x.map(function(e){
        return math.sqrt(e[0]*e[0]+e[1]*e[1]);
    });
}

function radix2_fft (x, k) {
    if (k === 1) {
        return [[x[0][0]+x[1][0], x[0][1]+x[1][1]], [x[0][0]-x[1][0], x[0][1]-x[1][1]]]
    } else {
        var e = x.filter(function(e, i, a){return (i%2===0);});
        var o = x.filter(function(e, i, a){return (i%2===1);});
        var Fe = radix2_fft(e, k-1);
        var LFo = phaseShift(radix2_fft(o, k-1));
        return (entrywiseComplexAdd(Fe, LFo)).concat(entrywiseComplexSubtract(Fe, LFo));
    }
}

function fft (x) {
    var k = math.ceil(math.log(x.length, 2));
    var n = math.pow(2, k);
    var z = new Array(n);
    for (var i = 0; i < x.length; i++) {
        z[i] = [x[i], 0];
    }
    for (i=x.length; i<n; i++) {
        z[i] = [0, 0];
    }
    return entrywiseComplexRealScalarMultiply(math.sqrt(1/n), radix2_fft(z, k));
}


function spectrogram (x, k, stride) {
    var n = math.pow(2, k);
    var m = x.length;
    var rem = (stride - ((m-n+1) % stride)) % stride; // Complete so last n are used
    var _m = m + rem; // Length of zero-padded version
    var l = math.ceil((m-n+1) / stride); // Number of columns in the spectrogram
    var z = new Array(_m);

    // Zero padding
    for (var i=0; i<_m-m; i++) {
        z[i] = [0, 0];
    }
    for (i=rem; i<_m; i++) {
        z[i] = [x[i-rem], 0];
    }

    // Allocate for the spectrogram
    var spec = new Array(l);
    // Compute the spectrogram
    for (i=0; i<l; i++) {
        spec[i] = entrywiseComplexAbsolute(radix2_fft(z.slice(i*stride, i*stride + n), k));
    }

    spec = transpose(spec);


    return ((spec.slice((n/2), n))).concat(spec.slice(0, (n/2)));
    //return spec;
}

function dyadic_dwt (x, k) {
    var n = math.pow(2, k-1);
    var v = new Array(n);
    var w = new Array(n);
    for (var i=0; i<n; i++) {
        var idx = 2*i;
        v[i] = (x[idx] + x[idx+1]) / math.sqrt(2);
        w[i] = (x[idx] - x[idx+1]) / math.sqrt(2);
    }

    if (k>1) {
        v = dyadic_dwt(v, k-1);
    }

    return v.concat(w);
}

function dyadic_idwt (x, k) {
    var n = math.pow(2, k-1);
    var v = new Array(n);
    var w = new Array(n);
    var z = new Array(2*n);

    for (var i=0; i<n; i++) {
        v[i] = x[i];
        w[i] = x[i+n];
    }

    if (k>1) {
        v = dyadic_idwt(v, k-1);
    }

    for (i=0; i<n; i++) {
        var idx = 2*i;
        z[idx] = (v[i] + w[i]) / math.sqrt(2);
        z[idx + 1] = (v[i] - w[i]) / math.sqrt(2);
    }

    return z;
}

function dwt (x) {
    var k = math.ceil(math.log(x.length, 2));
    var n = math.pow(2, k);
    var z = new Array(n);
    // Zero padding
    for (var i = 0; i < x.length; i++) {
        z[i] = x[i];
    }
    for (i=x.length; i<n; i++) {
        z[i] = 0;
    }

    return dyadic_dwt(z, k);
}

function idwt (x) {
    var k = math.ceil(math.log(x.length, 2));
    var n = math.pow(2, k);
    var z = new Array(n);
    // Zero padding
    for (var i = 0; i < x.length; i++) {
        z[i] = x[i];
    }
    for (i=x.length; i<n; i++) {
        z[i] = 0;
    }

    return dyadic_idwt(z, k);
}




/**
 * Initialize the acceleration chart
 * @param {Number} count - the number of time series to plot
 */
function initializeCharts (count) {
    count = count || 1;

    // Initialize data sets
    for (var j=0; j<count; j++) {
        for (var i in signalIds) {
            id = signalIds[i]
            accdata[id].push(math.cos(math.pi*j/16));
            unfilteredData[id].push(math.cos(math.pi*j/16));
        }
        t.push(getTime());
        events.push(0);
        xVal++;
    }

    accdata["xacc"].unshift('x');
    accdata["yacc"].unshift('y');
    accdata["zacc"].unshift('z');

    // Initialize the accelerometer chart
    chart = c3.generate({   bindto: '#chart',
        data: {
            columns: [accdata["xacc"],
                accdata["yacc"],
                accdata["zacc"]]
        },
        axis: {
            x: {
                type: 'category',
                tick: {
                    count: 11
                }
            }
        }
    });

    // Spectrogram data

    for (var i in signalIds) {
        id = signalIds[i]
        accspectrograms[id] = spectrogram(accdata[id].slice(1, dataLength+1), freqOrder, stride);
    }
     // Slice because the first index is the label

    xScale = d3.scale.linear()
        .range([0, width])
        .domain([0,accspectrograms['xacc'][0].length]);

    yScale = d3.scale.linear()
        .range([0, height])
        .domain([0,accspectrograms['xacc'].length]);

    svg["xacc"] = d3.select("#xspec").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    svg["yacc"] = d3.select("#yspec").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    svg["zacc"] = d3.select("#zspec").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", "translate(" + margin.left + "," + margin.top + ")");


    for (i in signalIds) {
        id = signalIds[i]
        row = svg[id].selectAll(".row")
            .data(accspectrograms[id])
            .enter().append("svg:g")
            .attr("class", "row");

        col = row.selectAll(".cell")
            .data(function (d,i) { return d.map(function(a) { return {value: a, row: i}; } ) })
            .enter().append("svg:rect")
            .attr("class", "cell")
            .attr("x", function(d, i) { return xScale(i); })
            .attr("y", function(d, i) { return yScale(d.row); })
            .attr("width", xScale(1))
            .attr("height", yScale(1))
            .style("fill", function(d) { return colorScale(d.value); });

    }

}


/**
 * Update acceleration data and re-render the chart
 * @param {array} values - acceleration values
 */
function appendCharts (values) {

    // Update the accelerometer data
    for (var i in signalIds) {
        id = signalIds[i];
        // Compute this step of the convolution
        unfilteredData[id].push(values[id]);
        unfilteredData[id].shift();

        var w = unfilteredData[id].slice(-6);
        var v = w[5] * hFIR[0]+ w[4] * hFIR[1] + w[3] * hFIR[2] + w[2]*hFIR[3] + w[1]*hFIR[4] +w[0]*hFIR[5];

        accdata[id].push(v);
        accdata[id].shift();
        accdata[id].shift();
    }

    accdata["xacc"].unshift('x');
    accdata["yacc"].unshift('y');
    accdata["zacc"].unshift('z');

    // Update accelerometer chart
    chart.load({
        columns: [accdata["xacc"], accdata["yacc"], accdata["zacc"]]
    });


    strideDelay++;
    // Update the spectrograms
    if (strideDelay === stride) {
        strideDelay = 0;
        for (var i in signalIds) {
            id = signalIds[i]
            var p = entrywiseComplexAbsolute(radix2_fft(real2complex(accdata[id].slice(-freqs)), freqOrder));

            for (var j=0; j<hfreqs; j++) {
                accspectrograms[id][j].shift();
                accspectrograms[id][j].push(p[j+hfreqs])

            }

            for (var j=hfreqs; j<freqs; j++) {
                accspectrograms[id][j].shift();
                accspectrograms[id][j].push(p[j-hfreqs])

            }

            row = svg[id].selectAll(".row").data(accspectrograms[id], function(d) {return d});
            row.selectAll(".cell").data(function(d) {return d}).style("fill", function(d) { return colorScale(d); }).transition();
        }
    }


    // Update event tag
    if (eventTag) {
        events.push(1);
        eventTag = false;
    } else {
        events.push(0);
    }
    events.shift();

    t.push(getTime());
    t.shift();

    xVal++;

}


/**
 * Run initializations on page loading
 */
function onLoad(){
    //document.addEventListener("deviceready", onDeviceReady, false);

    // Initialize the chart data and render
    initializeCharts(dataLength);

}


/**
 * Functions to run when the device is ready
 */
function onDeviceReady() {
    // Processes to start on initialization
}


/**
 * Initiate the watch for the accelerometer
 */
function startWatch() {
    var options = { frequency: 8 };
    watchID = navigator.accelerometer.watchAcceleration(onSuccess, onError, options);
}


/**
 * Cease the accelerometer watch
 */
function stopWatch() {
    if (watchID) {
        navigator.accelerometer.clearWatch(watchID);
        watchID = null;
    }
}


/**
 * Execute functions on successful acquisition of accelerometer data
 * @param {Number} acceleration - acceleration values
 * @param {Number} b
 * @return {Number} sum
 */
function onSuccess(acceleration) {
    appendCharts({xacc: acceleration.x, yacc: acceleration.y, zacc: acceleration.z});
}


/**
 * Generic error function
 */
function onError() {
    alert('Error!');
}


/**
 * Records collected accelerometer data to dropbox
 */
function record() {
    client.authenticate(function(error){
        // If an error happens
        if (error) {
            console.log('Authentication error: ' + error);
            return;
        }

        if (client.isAuthenticated()) {

            // CSV data is extracted and placed in data.txt
            var dataString = "";
            for (var j = 0; j < dataLength; j++) {
                dataString = dataString + j + ", " + t[j];
                for (var i in signalIds) {
                    id = signalIds[i];
                    dataString = dataString + ", " + accdata[id][j];
                }
                dataString = dataString + ", " + events[j] + "\n";

            }

            client.writeFile("data.txt", dataString, writeErrorStatus);

        } else {
            alert("No Dropbox Authentication detected, try again");
        }
    });

}

/**
 * Callback for registering a motion event
 */
function registerEvent() {
    eventTag = true;
}


//********AUDIO************


/**
 * Use device recorder to capture audio
 */
function recordAudio() {
    var options = { limit: 1 };
    navigator.device.capture.captureAudio(captureSuccess, captureError, options);
}


/**
 * Extract path to captured audio and save to dropbox
 * @param {MediaFiles} mediafiles - object storing audio file information
 */
function captureSuccess (mediaFiles) {
    var path = 'file://' + mediaFiles[0].fullPath; // Prepend device root location
    client.authenticate(function(error){
        // Check for error
        if (error) {
            alert("Authentication error.");
            return console.log('Authentication error: ' + error);
        }

        // If authenticated, complete the write
        if (client.isAuthenticated()) {
            // Find the file in the local file system and apply a callback
            window.resolveLocalFileSystemURI(path, saveAudioDropbox, rlfsURIError);
        } else {
            alert("No Dropbox Authentication detected, try again");
        }
    });
};


/**
 * Save audio file to audio.wav in dropbox
 * @param {FileEntry} fileEntry - container for file entry data
 */
function saveAudioDropbox (fileEntry) {
    fileEntry.file(function (file) {
        var reader = new FileReader();

        // Set callback for the reader; e is an event
        reader.onload = function (e) {
            client.writeFile("audio.wav", reader.result, writeErrorStatus);
        }

        // Perform the read
        reader.readAsArrayBuffer(file);

    });

};


//************IMAGE******************


/**
 * Save image to dropbox on successful image capture
 * @param {MediaFiles} mediaFiles - container for image file info
 * @param {Number} b
 * @return {Number} sum
 */
function imageCaptureSuccess (mediaFiles) {
    var path = 'file://' + mediaFiles[0].fullPath; // Prepend device root location
    client.authenticate(function(error){
        // Check for error
        if (error) {
            alert("Authentication error.");
            return console.log('Authentication error: ' + error);
        }

        // If authenticated, complete the write
        if (client.isAuthenticated()) {
            // Find the file in the local file system and apply a callback
            window.resolveLocalFileSystemURI(path, saveImageDropbox, rlfsURIError);
        } else {
            alert("No Dropbox Authentication detected, try again");
        }
    });
};


/**
 * Initiate recording of the image; triggers imageCaptureSuccess
 */
function recordImage() {
    var options = { limit: 1 };
    navigator.device.capture.captureImage(imageCaptureSuccess, captureError, options);
}

/**
 * Save image to dropbox
 * @param {FileEntry} fileEntry -- container for file information
 */
function saveImageDropbox (fileEntry) {
    fileEntry.file(function (file) {
        var reader = new FileReader();

        // Set callback for the reader; e is an event
        reader.onload = function (e) {
            client.writeFile("image.png", reader.result, writeErrorStatus);
        }

        // Perform the read
        reader.readAsArrayBuffer(file);

    });

};

//*********Get Yahoo Financial Data*************

/* Old get function that avoids JQuery
function httpGetAsync (theUrl, callback) {
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.withCredentials = false;
    xmlHttp.onreadystatechange = function() {
        if (xmlHttp.readyState == 4 && xmlHttp.status == 200)
            callback(xmlHttp.responseText);
    }
    xmlHttp.open("GET", theUrl, true); // true for asynchronous
    xmlHttp.send(null);
}
*/

function getYahoo () {
    var stockName1 = 'KO';
    var stockName2 = 'PEP';
    // "s" + "t" = "st"
    var stockURL1 = makeStockURL(stockName1);
    var stockURL2 = makeStockURL(stockName2);
    //httpGetAsync(stockURL, setFinanceDIV); // Results in access origin error if run in browser
    $.when($.get(stockURL1), $.get(stockURL2)).done(setFinanceDIV); // $ is JQuery
}

function getGoogle () {
    var currName1 = 'USD';
    var currName2 = 'JPY';
    var currName3 = 'EUR';
    // "s" + "t" = "st"

    //TODO: Implement makeCurrURL
    var currURL1 = makeCurrURL(currName1, currName2);
    var currURL2 = makeCurrURL(currName2, currName3);
    var currURL3 = makeCurrURL(currName3, currName1);
    //TODO: Implement setGoogleFinanceDIV
    $.when($.get(currURL1), $.get(currURL2), $.get(currURL3)).done(setGoogleFinanceDIV); // $ is JQuery

}

function makeCurrURL (currName1, currName2) {
    return "https://www.google.com/finance/getprices?i=60&p=1d&f=d,o,h,l,c,v&df=cpct&q="+currName1+currName2;
}

function makeStockURL(stockName) {
    return "http://chartapi.finance.yahoo.com/instrument/1.0/" + stockName + "/chartdata;type=quote;range=1d/csv";
}

function setGoogleFinanceDIV(resp1, resp2, resp3) {

    var resps = [resp1, resp2, resp3];
    FEXinfo = [null, null, null];
    var FEXlabels = ["USDJPY", "JPYEUR", "EURUSD"];
    var labels = ["Timestamp", "Close", "High", "Low", "Open", "Volume"];

    for (var i=0; i<3; i++) {
        var testText = resps[i][0].split('=');
        var csv = testText.pop();
        csv = csv.substring(csv.indexOf(',')+1);
        csv = '1,' + csv;
        var data = Papa.parse(csv, {
            dynamicTyping: true // converts numeric string to javascript numbers
        });
        data['data'].pop(); // Removes empty last row
        FEXinfo[i] = transpose(data['data']);

        // Start all data arrays with their label for graphing using c3
        for (var j=0; j<6; j++) {
            var label = FEXlabels[i]+ ' ' +labels[j];
            FEXinfo[i][j].unshift(label);
        }
    }

    var window = 9;
    var maxLen = Math.min(FEXinfo[0][1].length, FEXinfo[1][1].length, FEXinfo[2][1].length);
    var movingAverageRatio = new Array(maxLen-9+1);

    for (var i=8; i<maxLen; i++) {
        var a = 0;
        var b = 0;
        var c = 0;
        for (var j=0; j<window; j++) {
            a = a + FEXinfo[0][1][i-j];
            b = b + FEXinfo[1][1][i-j];
            c = c + FEXinfo[2][1][i-j];
        }
        movingAverageRatio[i-8] = a * b * c / (window * window * window);
    }

    movingAverageRatio.unshift('Arbitrage factor');


    //document.getElementById("financecsv").innerHTML = FEXinfo[1];

    // Charts of stock information
    ocChart = c3.generate({   bindto: '#closeopen',
        data: {
            columns: [FEXinfo[0][1], FEXinfo[1][1], FEXinfo[2][1]]
        },
        axis: {
            x: {
                type: 'category',
                tick: {
                    count: 6
                }
            }
        }
    });


    hlChart = c3.generate({   bindto: '#highlow',
        data: {
            columns: [movingAverageRatio]
        },
        axis: {
            x: {
                type: 'category',
                tick: {
                    count: 6
                }
            }
        }
    });
}

function setFinanceDIV (csv1, csv2) {

    var validCSV = (csv1[0].split(':')).pop(); // data after last colon is open/close volume + csv
    validCSV = validCSV.substring(validCSV.indexOf('\n')+1); // remove open/close volume

    var validCSV2 = (csv2[0].split(':')).pop();
    validCSV2 = validCSV2.substring(validCSV2.indexOf('\n')+1);

    //document.getElementById("financecsv").innerHTML=csv;
    var data = Papa.parse(validCSV, {
        dynamicTyping: true
    });

    var data2 = Papa.parse(validCSV2, {
        dynamicTyping: true
    });

    // alert('Parsing finished...');

    data['data'].pop(); // Get rid of erroneous data
    stockInfo = transpose(data['data']); // Data is in rows
    data2['data'].pop();
    stockInfo2 = transpose(data2['data']);

    dwtInfo = [stockInfo[0],
                    dwt(stockInfo[1]),
                    dwt(stockInfo[2]),
                    dwt(stockInfo[3]),
                    dwt(stockInfo[4]),
                    dwt(stockInfo[5])];

    dwtInfo2 = [stockInfo2[0],
                    dwt(stockInfo2[1]),
                    dwt(stockInfo2[2]),
                    dwt(stockInfo2[3]),
                    dwt(stockInfo2[4]),
                    dwt(stockInfo2[5])];

    // Start all data arrays with their label for graphing
    var labels = ["Timestamp", "Close", "High", "Low", "Open", "Volume"];
    for (var i=0; i<6; i++) {
        var label = labels[i];
        stockInfo[i].unshift('KO '+label);
        stockInfo2[i].unshift('PEP ' + label);
        dwtInfo[i].unshift('DWT KO '+label);
        dwtInfo2[i].unshift('DWT PEP '+label);
    }

    // Charts of stock information
    ocChart = c3.generate({   bindto: '#closeopen',
        data: {
            columns: [stockInfo[1], stockInfo[4], stockInfo2[1], stockInfo2[4]]
        },
        axis: {
            x: {
                type: 'category',
                tick: {
                    count: 6
                }
            }
        }
    });

    hlChart = c3.generate({   bindto: '#highlow',
        data: {
            columns: [stockInfo[2], stockInfo[3], stockInfo2[2], stockInfo2[3]]
        },
        axis: {
            x: {
                type: 'category',
                tick: {
                    count: 6
                }
            }
        }
    });

    volChart = c3.generate({   bindto: '#volume',
        data: {
            columns: [stockInfo[5], stockInfo2[5]]
        },
        axis: {
            x: {
                type: 'category',
                tick: {
                    count: 6
                }
            }
        }
    });

    dwtChart = c3.generate({   bindto: '#dwt',
        data: {
            columns: [dwtInfo[2], dwtInfo[3], dwtInfo2[2], dwtInfo2[3]]
        },
        axis: {
            x: {
                type: 'category',
                tick: {
                    count: 6
                }
            }
        }
    });

}

//*********Error functions*************

// Function for Dropbox write errors and saving file status
var writeErrorStatus = function(error, stat) {
    if (error) {
        alert("Error writing file.");
        return console.log(error);
    }

    console.log(stat);
    console.log("File saved as revision " + stat.versionTag);
};


// Error handling function for resolve local file system
var rlfsURIError = function(error) {
    alert('Error in resolving local file system.');
    return console.log('Error in resolving local file system.');
}


// Capture error callback
var captureError = function(error) {
    navigator.notification.alert('Error code: ' + error.code, null, 'Capture Error');
};

