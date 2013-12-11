/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// Test cases for MessageTray URLification

const Lang = imports.lang;
const JsUnit = imports.jsUnit;

const Environment = imports.ui.environment;
Environment.init();

const JsParse = imports.misc.jsParse;

// Utility function for comparing arrays
function assertArrayEquals(errorMessage, array1, array2) {
    JsUnit.assertEquals(errorMessage + ' length',
                        array1.length, array2.length);
    for (let j = 0; j < array1.length; j++) {
        JsUnit.assertEquals(errorMessage + ' item ' + j,
                            array1[j], array2[j]);
    }
}

//
// Test javascript parsing
//
//
// TODO: We probably want to change all these to use
//       a table driven method, using for() inside
//       a test body hampers readibility and
//       debuggability when something goes wrong.

function testParseForMatchingQuoteForEndOfString() {
    const testsFindMatchingQuote = [
        { input: '"double quotes"',
        output: 0 },
        { input: '\'single quotes\'',
        output: 0 },
        { input: 'some unquoted "some quoted"',
        output: 14 },
        { input: '"mixed \' quotes\'"',
          output: 0 },
        { input: '"escaped \\" quote"',
          output: 0 }
    ];

    for (let i = 0; i < testsFindMatchingQuote.length; i++) {
        let text = testsFindMatchingQuote[i].input;
        let match = JsParse.findMatchingQuote(text, text.length - 1);
        let expected = testsFindMatchingQuote[i].output;

        JsUnit.assertEquals("Matching quote not found at position " + expected,
                            match, expected);
    }
}


function testParseForMatchingSlashAtEndOfString() {
    const testsFindMatchingSlash = [
        { input: '/slash/',
          output: 0 },
        { input: '/slash " with $ funny ^\' stuff/',
          output: 0  },
        { input: 'some unslashed /some slashed/',
          output: 15 },
        { input: '/escaped \\/ slash/',
          output: 0 }
    ];

    for (let i = 0; i < testsFindMatchingSlash.length; i++) {
        let text = testsFindMatchingSlash[i].input;
        let match = JsParse.findMatchingSlash(text, text.length - 1);
        let expected = testsFindMatchingSlash[i].output;

        JsUnit.assertEquals("Matching slash not found at position " + expected,
                            match, expected);
    }
}

function testParseForMatchingBraceAtEndOfString() {
    const testsFindMatchingBrace = [
        { input: '[square brace]',
          output: 0 },
        { input: '(round brace)',
          output: 0  },
        { input: '([()][nesting!])',
          output: 0 },
        { input: '[we have "quoted [" braces]',
          output: 0 },
        { input: '[we have /regex [/ braces]',
          output: 0 },
        { input: '([[])[] mismatched braces ]',
          output: 1 }
    ];

    for (let i = 0; i < testsFindMatchingBrace.length; i++) {
        let text = testsFindMatchingBrace[i].input;
        let match = JsParse.findMatchingBrace(text, text.length - 1);
        let expected = testsFindMatchingBrace[i].output;

        JsUnit.assertEquals("Matching brace not found at position " + expected,
                            match, expected);
    }
}

function testSearchForBeginningOfExpression() {
    const testsGetExpressionOffset = [
        { input: 'abc.123',
          output: 0 },
        { input: 'foo().bar',
          output: 0  },
        { input: 'foo(bar',
          output: 4 },
        { input: 'foo[abc.match(/"/)]',
          output: 0 }
    ];

    for (let i = 0; i < testsGetExpressionOffset.length; i++) {
        let text = testsGetExpressionOffset[i].input;
        let match = JsParse.getExpressionOffset(text, text.length - 1);
        let expected = testsGetExpressionOffset[i].output;

        JsUnit.assertEquals("Beginning of expression matches was not at " + expected,
                            match, expected);
    }
}

function testFindConstantVariableIdentifiersInExpression() {
    const testsGetDeclaredConstants = [
        { input: 'const foo = X; const bar = Y;',
          output: ['foo', 'bar'] },
        { input: 'const foo=X; const bar=Y',
          output: ['foo', 'bar'] }
    ];

    for (let i = 0; i < testsGetDeclaredConstants.length; i++) {
        let text = testsGetDeclaredConstants[i].input;
        let match = JsParse.getDeclaredConstants(text);
        let expected = testsGetDeclaredConstants[i].output;
        
        let message = "Expected to find the following constants :\n";
        let messageReference = { m: message };
        let closure = Lang.bind(this, function(item) {
            this.messageReference += "= " + item + "\n";
        });
        
        expected.forEach(closure);
        
        assertArrayEquals(messageReference.m,
                          match, expected);
    }
}

function testIsUnsafeExpression() {
    const testsIsUnsafeExpression = [
        { input: 'foo.bar',
          output: false },
        { input: 'foo[\'bar\']',
          output: false  },
        { input: 'foo["a=b=c".match(/=/)',
          output: false },
        { input: 'foo[1==2]',
          output: false },
        { input: '(x=4)',
          output: true },
        { input: '(x = 4)',
          output: true },
        { input: '(x;y)',
          output: true }
    ];

    for (let i = 0; i < testsIsUnsafeExpression.length; i++) {
        let text = testsIsUnsafeExpression[i].input;
        let unsafe = JsParse.isUnsafeExpression(text);
        let expected = testsIsUnsafeExpression[i].output;
        
        let message = "Expected that parser found that the expression " +
                      text + " was " + (expected == true ? "unsafe" : "safe");

        JsUnit.assertEquals(message,
                            unsafe, testsIsUnsafeExpression[i].output);
    }
}

//
// Test safety of eval to get completions
//
function testSafetyOfEval() {
    const HARNESS_COMMAND_HEADER = "let imports = obj;" +
                                   "let global = obj;" +
                                   "let Main = obj;" +
                                   "let foo = obj;" +
                                   "let r = obj;";

    const testsModifyScope = [
        "foo['a",
        "foo()['b'",
        "obj.foo()('a', 1, 2, 'b')().",
        "foo.[.",
        "foo]]]()))].",
        "123'ab\"",
        "Main.foo.bar = 3; bar.",
        "(Main.foo = 3).",
        "Main[Main.foo+=-1]."
    ];

    for (let i = 0; i < testsModifyScope.length; i++) {
        let text = testsModifyScope[i];
        // We need to use var here for the with statement
        var obj = {};

        // Just as in JsParse.getCompletions, we will find the offset
        // of the expression, test whether it is unsafe, and then eval it.
        let offset = JsParse.getExpressionOffset(text, text.length - 1);
        if (offset >= 0) {
            text = text.slice(offset);

            let matches = text.match(/(.*)\.(.*)/);
            if (matches) {
                [expr, base, attrHead] = matches;

                if (!JsParse.isUnsafeExpression(base)) {
                    with (obj) {
                        try {
                            eval(HARNESS_COMMAND_HEADER + base);
                        } catch (e) {
                            JsUnit.assertNotEquals("Code '" + base + "' is valid code", e.constructor, SyntaxError);
                        }
                    }
               }
           }
        }
        let propertyNames = Object.getOwnPropertyNames(obj);
        JsUnit.assertEquals("The context '" + JSON.stringify(obj) + "' was not modified", propertyNames.length, 0);
    }
}
