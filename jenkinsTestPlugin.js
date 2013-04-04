const INDENT_AMOUNT = 4;
const TIME_RESOLUTION = 5;

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

    return _indent("<" + tag_name + propertyString + ">\n", indentationLevel);
}

function _formatTime(timeTaken){
    roundedTime = timeTaken * Math.pow(10, TIME_RESOLUTION);
    roundedTime = Math.round(roundedTime);
 
    return "" + roundedTime / Math.pow(10, TIME_RESOLUTION);
}

function outputJenkinsResults(filename, classname, results){
    const XML_HEADER = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    const ROOT_NODE = "testsuite";
    const TESTCASE = "testcase";

    let xmlContent = XML_HEADER;
    xmlContent += _tag(ROOT_NODE, { 'name': classname, 'tests': 123, 'errors': 123, 'failures': 0, 'skip':0} );
    
    results.forEach(function(result){
        let testClass = classname + "." + result.name;
        xmlContent += _tag(TESTCASE, { 'classname': testClass, 'name':result.name, 'time':_formatTime(result.time) }, 1) + _closingTag(TESTCASE, 1);
    });
    xmlContent += _closingTag(ROOT_NODE);
    
    print(xmlContent);

    const Gio = imports.gi.Gio;
    let outputFile = Gio.file_new_for_path(filename);
    let fileOutputStream = outputFile.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    let dataOutputStream = Gio.DataOutputStream.new(fileOutputStream);
    dataOutputStream.write(xmlContent, null, null);
    dataOutputStream.flush(null);
    fileOutputStream.close(null);
}
