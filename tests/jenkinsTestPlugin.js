const INDENT_AMOUNT = 4;
const TIME_RESOLUTION = 5;

const CDATA_START = '<![CDATA[';
const CDATA_END = ']]>';

function _indent(text, indentationLevel){
    let indentationString = "";
    if(indentationLevel && indentationLevel > 0){
        indentationString = Array(indentationLevel * INDENT_AMOUNT).join(" ");
    }
    return indentationString + text;
}

function _closingTag(tag_name, indentationLevel){
    return _indent("</" + tag_name + ">\n", indentationLevel);
}

function _tag(tag_name, properties, indentationLevel){
    let propertyString = "";
    if (properties){
        propertyString += " ";
        Object.keys(properties).forEach(function(property){
            propertyString += property + "=\"" + properties[property] + "\" ";
        });
    }

    return _indent("<" + tag_name + propertyString + ">", indentationLevel);
}

function _formatTime(timeTaken){
    let roundedTime = timeTaken * Math.pow(10, TIME_RESOLUTION);
    roundedTime = Math.round(roundedTime);
 
    return "" + roundedTime / Math.pow(10, TIME_RESOLUTION);
}

function _errorNode(error) {
    const ERROR_NODE='error';
    let properties = { 'type': error.type,
                       'message': error.message };

    let errorNodeString = _tag(ERROR_NODE, properties, 2);
    errorNodeString += CDATA_START + error.stackTrace + CDATA_END;
    errorNodeString += _closingTag(ERROR_NODE);

    return errorNodeString;
}

function outputJenkinsResults(filename, aggregateResults){
    const XML_HEADER = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    const ROOT_NODE = "testsuite";
    const TESTCASE = "testcase";
    const LINE_BREAK = "\n";

    let xmlContent = XML_HEADER;
    let properties = { 'name': aggregateResults.name, 
                       'tests': aggregateResults.tests, 
                       'errors': aggregateResults.errors, 
                       'failures': aggregateResults.failures, 
                       'skip': aggregateResults.skip };
    xmlContent += _tag(ROOT_NODE, properties) + LINE_BREAK;

    aggregateResults.results.forEach(function(result){
        let properties = { 'classname': aggregateResults.name + "." + result.name,
                           'name':result.name, 
                           'time':_formatTime(result.time) };

        xmlContent += _tag(TESTCASE, properties, 1) + LINE_BREAK;
        if ("error" in result) {
            xmlContent += _errorNode(result.error);
        }
        xmlContent += _closingTag(TESTCASE, 1);
    });
    xmlContent += _closingTag(ROOT_NODE);
    
    if (this.DEBUG) print(xmlContent);

    const Gio = imports.gi.Gio;
    let outputFile = Gio.file_new_for_path(filename);
    let fileOutputStream = outputFile.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    let dataOutputStream = Gio.DataOutputStream.new(fileOutputStream);
    dataOutputStream.write(xmlContent, null, null);
    dataOutputStream.flush(null);
    fileOutputStream.close(null);
}
