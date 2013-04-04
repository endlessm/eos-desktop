const INDENT_AMOUNT = 4;

function _closingTag(tag_name, indentationLevel){
    let indentationString = "";
    if(indentationLevel){
        indentationString = Array(indentationLevel * INDENT_AMOUNT).join(" ");
    }

    return indentationString + "</" + tag_name + ">\n";
}

function _tag(tag_name, properties, indentationLevel){
    let propertyString = "";
    if (properties){
        propertyString += " ";
        Object.keys(properties).forEach(function(property){
            propertyString += property + "=\"" + properties[property] + "\" ";
        });
    }

    let indentationString = "";
    if(indentationLevel){
        indentationString = Array(indentationLevel * INDENT_AMOUNT).join(" ");
    }
    return indentationString + "<" + tag_name + propertyString + ">\n";
}

function outputJenkinsResults(filename, classname, results){
    const XML_HEADER = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
    const ROOT_NODE = "testsuite";
    const TESTCASE = "testcase";

    let xmlContent = XML_HEADER;
    xmlContent += _tag(ROOT_NODE);
    
    results.forEach(function(result){
        let testClass = classname + "." + result.name;
        xmlContent += _tag(TESTCASE, { 'classname': testClass, 'name':result.name }, 1) + _closingTag(TESTCASE, 1);
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
