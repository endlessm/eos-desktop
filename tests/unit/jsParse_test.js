/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// Test cases for MessageTray URLification

const Lang = imports.lang;
const JsParse = imports.misc.jsParse;
const CoreEnvironment = imports.misc.coreEnvironment;

//
// Test javascript parsing
//
//
// TODO: We probably want to change all these to use
//       a table driven method, using for() inside
//       a test body hampers readibility and
//       debuggability when something goes wrong.
//
// NOTE: The inconsistent use of "" and '' quotes in this
//       file is largely to handle nesting without passing
//       escape markers to the functions under test. The
//       preferred style in the shell is single quotes
//       so we use that wherever possible.

describe('Matching quote search', function() {

    beforeEach(function() {
        CoreEnvironment.coreInit();
    });

    const FindMatchingQuoteParameters = {
        'only double quotes' : {
            input: "'double quotes'",
            output: 0
        },
        'only single quotes' : {
            input: '\'single quotes\'',
            output: 0
        },
        'some parts unquoted and other parts quoted' : {
            input: "some unquoted 'some quoted'",
            output: 14
        },
        'mixed quotes' : {
            input: "'mixed \" quotes\"'",
            output: 0
        },
        'escaped quotes' : {
            input: "'escaped \\' quote'",
            output: 0
        }
    };
    
    for (let key in FindMatchingQuoteParameters) {
        (function(TestName, Input, Output) {
             it('finds a matching quote where there are ' + TestName, function() {
                 let match = JsParse.findMatchingQuote(Input, Input.length - 1);
                 expect(match).toEqual(Output);
             });
         })(key,
            FindMatchingQuoteParameters[key].input,
            FindMatchingQuoteParameters[key].output);
    }
});

describe('Matching slash search', function() {

    beforeEach(function() {
        CoreEnvironment.coreInit();
    });

    const FindMatchingSlashParameters = {
        'matching slashes' : {
            input: '/slash/',
            output: 0
        },
        'matching slashes with extraneous characters in-between' : {
            input: "/slash ' with $ funny ^\' stuff/",
            output: 0 
        },
        'mathcing slashes with some parts unslashed' : {
            input: 'some unslashed /some slashed/',
            output: 15
        },
        'matching slashes with an escaped slash in the middle' : {
            input: '/escaped \\/ slash/',
            output: 0
        }
    };
    
    for (let key in FindMatchingSlashParameters) {
        (function(TestName, Input, Output) {
             it('finds a matching slash where there are ' + TestName, function() {
                 let match = JsParse.findMatchingSlash(Input, Input.length - 1);

                 expect(match).toEqual(Output);
             });
         })(key,
            FindMatchingSlashParameters[key].input,
            FindMatchingSlashParameters[key].output);
    }
});

describe('Matching brace search', function() {

    beforeEach(function() {
        CoreEnvironment.coreInit();
    });

    const FindMatchingBraceParameters = {
        'square braces' : {
            input: '[square brace]',
            output: 0
        },
        'round braces' : {
            input: '(round brace)',
            output: 0
        },
        'braces with nesting' : {
            input: '([()][nesting!])',
            output: 0
        },
        'braces with quoted braces in the middle' : {
            input: "[we have 'quoted [' braces]",
            output: 0
        },
        'braces with regexed braces in the middle' : {
            input: '[we have /regex [/ braces]',
            output: 0
        },
        'mismatched braces' : {
            input: '([[])[] mismatched braces ]',
            output: 1
        }
    };
    
    for (let key in FindMatchingBraceParameters) {
        (function(TestName, Input, Output) {
             it('finds matching braces where there are ' + TestName, function() {
                 let match = JsParse.findMatchingBrace(Input, Input.length - 1);
                
                 expect(match).toEqual(Output);
             });
         })(key,
            FindMatchingBraceParameters[key].input,
            FindMatchingBraceParameters[key].output);
    };
});

describe('Beginning of expression search', function() {

    beforeEach(function() {
        CoreEnvironment.coreInit();
    });

    const ExpressionOffsetParameters = {
        'object property name' : {
            input: 'abc.123',
            output: 0
        },
        'function call result property name' : {
            input: 'foo().bar',
            output: 0
        },
        'centre of malformed function call expression' : {
            input: 'foo(bar',
            output: 4
        },
        'complete nested expression' : {
            input: "foo[abc.match(/'/)]",
            output: 0
        }
    };
    
    for (let key in ExpressionOffsetParameters) {
        (function(TestName, Input, Output){
             it('finds the beginning of a ' + TestName, function() {
                 let match = JsParse.getExpressionOffset(Input, Input.length - 1);
                 
                 expect(match).toEqual(Output);
             });
         })(key,
            ExpressionOffsetParameters[key].input,
            ExpressionOffsetParameters[key].output);
    }
});

describe('Constant variable search', function() {

    beforeEach(function() {
        CoreEnvironment.coreInit();
    });

    const DeclaredConstantsParameters = {
        'two constants on one line with space between equals' : {
            input : 'const foo = X; const bar = Y',
            output : ['foo', 'bar']
        },
        'two constants on one line with no space between equlas' : {
            input : 'const foo=X; const bar=Y;',
            output : ['foo', 'bar']
        }
    };
    
    for (let key in DeclaredConstantsParameters) {
        (function(TestName, Input, Output) {
             it('finds ' + TestName, function() {
                 let match = JsParse.getDeclaredConstants (Input);
                 expect(match).toEqual(Output);
             });
         })(key,
            DeclaredConstantsParameters[key].input,
            DeclaredConstantsParameters[key].output);
     }
});

describe ('Expression safety determination', function() {

    beforeEach(function() {
        CoreEnvironment.coreInit();
    });

    const UnsafeExpressionParams = {
        'property access' : {
            input : 'foo.bar',
            output: false
        },
        'property access by array' : {
            input : 'foo[\'bar\']',
            output : false
        },
        'expression with syntax error' : {
            input: "foo['a=b=c'.match(/=/)",
            output: false
        },
        'property access by array with nested const expression': {
            input: 'foo[1==2]',
            output: false
        },
        'bracketed assignment no whitespace' : {
            input: '(x=4)',
            output: true
        },
        'bracked assignment with whitespace' : {
            input: '(x = 4)',
            output: true
        },
        'bracketed implicit call' : {
            input: '(x;y)',
            output: true
        }
    };
    
    for (let key in UnsafeExpressionParams) {
        (function(TestName, Input, Output) {
             let IsOrIsNot;
             
             if (Output == true)
                 IsOrIsNot = 'is';
             else
                 IsOrIsNot = 'is not';
             
             it('finds that an expresison which is a ' + TestName + ' ' + IsOrIsNot + ' safe', function() {
                 let unsafe = JsParse.isUnsafeExpression(Input);
                 expect(unsafe).toEqual(Output);
             });
         })(key,
            UnsafeExpressionParams[key].input,
            UnsafeExpressionParams[key].output);
    }
});

//
// Test safety of eval to get completions
//
describe ('Expression evaluation', function() {

    beforeEach(function() {
        CoreEnvironment.coreInit();
    });

    const HARNESS_COMMAND_HEADER = 'let imports = obj;' +
                                   'let global = obj;' +
                                   'let Main = obj;' +
                                   'let foo = obj;' +
                                   'let r = obj;';

    const ExpressionParameters = [
        "foo['a",
        "foo()['b'",
        "obj.foo()('a', 1, 2, 'b')().",
        "foo.[.",
        'foo]]]()))].',
        "123'ab\'",
        "Main.foo.bar = 3; bar.",
        '(Main.foo = 3).',
        'Main[Main.foo+=-1].'
    ];
    
    // Performs the action if the expression is safe and returns any
    // captured global state
    function performIfExpressionIsOstensiblySafe (expression, action) {
        let text = expression;
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
                    action (base, obj);
                }
            }
        }
        return obj;
    }
    
    for (let i = 0; i < ExpressionParameters.length; i++) {
        let EvaluateCommandHeaderAndExpression = function(expression, obj) {
            with (obj) {
                eval(HARNESS_COMMAND_HEADER + base);
            }
            return obj;
        }

        const expression = ExpressionParameters[i];
        (function(expression){
             it('of ' + expression + ' does not encounter syntax errors when executing an expression known to be safe', function() {
                 let action = function(base, obj) {
                     expect(function() {
                         EvaluateCommandHeaderAndExpression(base, obj);
                     }).not.toThrow(SyntaxError);
                 }
                 
                 performIfExpressionIsOstensiblySafe (expression, action);
             });
             it('of ' + expression + ' does not modify the global scope upon executing an expression known to be safe', function() {
                 let action = function(base, obj) {
                     /* There may be other exceptions raised by this code, and we
                      * asserted earlier that anything other than a syntax error was
                      * acceptable, so swallow them here */
                     try {
                         EvaluateCommandHeaderAndExpression(base, obj);
                     } catch (e) {
                     }
                 }
                 
                 const globalState = performIfExpressionIsOstensiblySafe(expression, action);
                 const globalStateNParameters = Object.getOwnPropertyNames(globalState).length;
                 
                 expect(globalStateNParameters).toEqual(0);
             });
         })(expression);
    }
});
