// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

// Test cases for MessageTray URLification

const Util = imports.misc.util;
const CoreEnvironment = imports.misc.coreEnvironment;

// TODO: A real table driven framework is required here, these are not
//       all testing the same thing.

describe('URL-in-string finder', function() {

    beforeEach(function() {
        CoreEnvironment.coreInit();
    });

    const URLParameters = [
        { input: 'This is a test',
          output: [] },
        { input: 'This is http://www.gnome.org a test',
          output: [ { url: 'http://www.gnome.org', pos: 8 } ] },
        { input: 'This is http://www.gnome.org',
          output: [ { url: 'http://www.gnome.org', pos: 8 } ] },
        { input: 'http://www.gnome.org a test',
          output: [ { url: 'http://www.gnome.org', pos: 0 } ] },
        { input: 'http://www.gnome.org',
          output: [ { url: 'http://www.gnome.org', pos: 0 } ] },
        { input: 'Go to http://www.gnome.org.',
          output: [ { url: 'http://www.gnome.org', pos: 6 } ] },
        { input: 'Go to http://www.gnome.org/.',
          output: [ { url: 'http://www.gnome.org/', pos: 6 } ] },
        { input: '(Go to http://www.gnome.org!)',
          output: [ { url: 'http://www.gnome.org', pos: 7 } ] },
        { input: 'Use GNOME (http://www.gnome.org).',
          output: [ { url: 'http://www.gnome.org', pos: 11 } ] },
        { input: 'This is a http://www.gnome.org/path test.',
          output: [ { url: 'http://www.gnome.org/path', pos: 10 } ] },
        { input: 'This is a www.gnome.org scheme-less test.',
          output: [ { url: 'www.gnome.org', pos: 10 } ] },
        { input: 'This is a www.gnome.org/scheme-less test.',
          output: [ { url: 'www.gnome.org/scheme-less', pos: 10 } ] },
        { input: 'This is a http://www.gnome.org:99/port test.',
          output: [ { url: 'http://www.gnome.org:99/port', pos: 10 } ] },
        { input: 'This is an ftp://www.gnome.org/ test.',
          output: [ { url: 'ftp://www.gnome.org/', pos: 11 } ] },

        { input: 'Visit http://www.gnome.org/ and http://developer.gnome.org',
          output: [ { url: 'http://www.gnome.org/', pos: 6 },
		    { url: 'http://developer.gnome.org', pos: 32 } ] },

        { input: 'This is not.a.domain test.',
          output: [ ] },
        { input: 'This is not:a.url test.',
          output: [ ] },
        { input: 'This is not:/a.url/ test.',
          output: [ ] },
        { input: 'This is not:/a.url/ test.',
          output: [ ] },
        { input: 'This is not@a.url/ test.',
          output: [ ] },
        { input: 'This is surely@not.a/url test.',
          output: [ ] }
    ];

    for (let i = 0; i < URLParameters.length; i++) {
        const url = URLParameters[i];
        (function(Input, Output) {
             let findsOrDoesNotFind;
             
             if (Output.length > 0)
                 findsOrDoesNotFind = 'Finds';
             else
                 findsOrDoesNotFind = 'Does not find';
        
             it(findsOrDoesNotFind + ' URLs in ' + Input, function() {
                 let match = Util.findUrls(Input);
                 
                 expect(match).toEqual(Output);
             });
         })(url.input, url.output);
    };
});
