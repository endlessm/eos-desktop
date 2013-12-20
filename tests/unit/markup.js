// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

// Test cases for MessageTrayMarkup markup parsing

const Pango = imports.gi.Pango;
const MessageTrayMarkup = imports.ui.messageTrayMarkup;
const CoreEnvironment = imports.misc.coreEnvironment;

describe ('Markup Fixer', function() {

    function convertAndEscape(text) {
        const conversion = MessageTrayMarkup.fixMarkupForMessageTray(text, MessageTrayMarkup.FixType.CONVERT);
        const escape = MessageTrayMarkup.fixMarkupForMessageTray(text, MessageTrayMarkup.FixType.ESCAPE);
        return {
            converted: conversion,
            escaped: escape
        };
    }

    beforeEach(function() {
        CoreEnvironment.coreInit();
        jasmine.addMatchers({
            toParseCorrectlyAndMatch: function() {
                return {
                    compare: function(actual, match) {
                        if (!match)
                            match = actual;
                        
                        const result = {

                            pass: (function() {
                                try {
                                    Pango.parse_markup(actual, -1, '');
                                    return match == actual;
                                } catch (e) {
                                    return false;
                                }
                            })(),
                        
                            message: 'Expected ' + actual + ' to parse correctly and ' +
                                     'for ' + actual + ' to equal ' + match
                        };
                        return result;
                    }
                }
            }
       });  
    });
    it ('does not do anything on no markup', function() {
        const text = 'foo';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch(text);
        expect(result.escaped).toParseCorrectlyAndMatch(text);
    });
    it ('converts and escapes bold markup', function() {
        const text = '<b>foo</b>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch();
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;b&gt;foo&lt;/b&gt;');
    });
    it ('converts and escapes italic markup', function() {
        const text = 'something <i>foo</i>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch();
        expect(result.escaped).toParseCorrectlyAndMatch('something &lt;i&gt;foo&lt;/i&gt;');
    });
    it ('converts and escapes underlined markup', function() {
        const text = '<u>foo</u> something';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch();
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;u&gt;foo&lt;/u&gt; something');
    });
    it ('converts and escapes non-ntested bold italic and underline markup', function() {
        const text = '<b>bold</b> <i>italic <u>and underlined</u></i>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch();
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;b&gt;bold&lt;/b&gt; &lt;i&gt;italic &lt;u&gt;and underlined&lt;/u&gt;&lt;/i&gt;');
    });
    it ('converts and escapes ampersands', function() {
        const text = 'this &amp; that';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch();
        expect(result.escaped).toParseCorrectlyAndMatch('this &amp;amp; that');
    });
    it ('converts and escapes <', function() {
        const text = 'this &lt; that';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch();
        expect(result.escaped).toParseCorrectlyAndMatch('this &amp;lt; that');
    });
    it ('converts and escapes >', function() {
        const text = 'this &lt; that &gt; the other';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch();
        expect(result.escaped).toParseCorrectlyAndMatch('this &amp;lt; that &amp;gt; the other');
    });
    it ('converts and escapes HTML markup inside escaped tags', function() {
        const text = 'this &lt;<i>that</i>&gt;';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch();
        expect(result.escaped).toParseCorrectlyAndMatch('this &amp;lt;&lt;i&gt;that&lt;/i&gt;&amp;gt;');
    });
    it ('convertes and escapes angle brackets within HTML markup', function() {
        const text = 'this &lt;<i>that</i>&gt;';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch();
        expect(result.escaped).toParseCorrectlyAndMatch('this &amp;lt;&lt;i&gt;that&lt;/i&gt;&amp;gt;');
    });
    it ('converts and escapes markup whilst still keeping an unrecognized entity', function() {
        const text = '<b>smile</b> &#9786;!';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch();
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;b&gt;smile&lt;/b&gt; &amp;#9786;!');
    });
    it ('converts and escapes markup and a stray ampersand', function() {
        const text = '<b>this</b> & <i>that</i>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('<b>this</b> &amp; <i>that</i>');
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;b&gt;this&lt;/b&gt; &amp; &lt;i&gt;that&lt;/i&gt;');
    });
    it ('converst and escapes a stray <', function() {
        const text = 'this < that';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('this &lt; that');
        expect(result.escaped).toParseCorrectlyAndMatch('this &lt; that');
    });
    it ('converts and escapes markup with a stray <', function() {
        const text = '<b>this</b> < <i>that</i>';
        const result = convertAndEscape(text);
        expect (result.converted).toParseCorrectlyAndMatch('<b>this</b> &lt; <i>that</i>');
        expect (result.escaped).toParseCorrectlyAndMatch('&lt;b&gt;this&lt;/b&gt; &lt; &lt;i&gt;that&lt;/i&gt;');
    });
    it ('converts and escapes stray less than and greater than characters that do not form tags', function() {
        const text = 'this < that > the other';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('this &lt; that > the other');
        expect(result.escaped).toParseCorrectlyAndMatch('this &lt; that &gt; the other');
    });
    it ('converts and escapes stray less than and greater than characters next to HTML markup tags', function() {
        const text = 'this <<i>that</i>>'
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('this &lt;<i>that</i>>');
        expect(result.escaped).toParseCorrectlyAndMatch('this &lt;&lt;i&gt;that&lt;/i&gt;&gt;');
    });
    it ('converts and escapes angle brackets around unknown tags', function() {
        const text = '<unknown>tag</unknown>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('&lt;unknown>tag&lt;/unknown>');
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;unknown&gt;tag&lt;/unknown&gt;');
    });
    it ('converts and escapes angle brackets around unknown tags where the first letter might otherwise be valid HTML markup', function() {
        const text = '<bunknown>tag</bunknown>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('&lt;bunknown>tag&lt;/bunknown>');
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;bunknown&gt;tag&lt;/bunknown&gt;');
    });
    it ('converts good tags but escapes bad tags', function() {
        const text = '<i>known</i> and <unknown>tag</unknown>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('<i>known</i> and &lt;unknown>tag&lt;/unknown>');
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;i&gt;known&lt;/i&gt; and &lt;unknown&gt;tag&lt;/unknown&gt;');
    });
    it ('completely escapes mismatched tags where the mismatch is at the beginning', function() {
        const text = '<b>in<i>com</i>plete';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('&lt;b&gt;in&lt;i&gt;com&lt;/i&gt;plete');
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;b&gt;in&lt;i&gt;com&lt;/i&gt;plete');
    });
    it ('completely escapes mismatched tags where the mismatch is at the end', function() {
        const text = 'in<i>com</i>plete</b>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('in&lt;i&gt;com&lt;/i&gt;plete&lt;/b&gt;');
        expect(result.escaped).toParseCorrectlyAndMatch('in&lt;i&gt;com&lt;/i&gt;plete&lt;/b&gt;');
    });
    it ('escapes all tags where there are attributes', function() {
        const text = '<b>good</b> and <b style=\'bad\'>bad</b>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('&lt;b&gt;good&lt;/b&gt; and &lt;b style=&apos;bad&apos;&gt;bad&lt;/b&gt;');
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;b&gt;good&lt;/b&gt; and &lt;b style=&apos;bad&apos;&gt;bad&lt;/b&gt;');
    });
    it ('escapes all tags where syntax is invalid', function() {
        const text = '<b>unrecognized</b stuff>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('&lt;b&gt;unrecognized&lt;/b stuff&gt;');
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;b&gt;unrecognized&lt;/b stuff&gt;');
    });
    it ('escapes completely mismatched tags', function() {
        const text = '<b>mismatched</i>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('&lt;b&gt;mismatched&lt;/i&gt;');
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;b&gt;mismatched&lt;/i&gt;');
    });
    it ('escapes mismatched tags where the first character is mismatched', function() {
        const text = '<b>mismatched/unknown</bunknown>';
        const result = convertAndEscape(text);
        expect(result.converted).toParseCorrectlyAndMatch('&lt;b&gt;mismatched/unknown&lt;/bunknown&gt;');
        expect(result.escaped).toParseCorrectlyAndMatch('&lt;b&gt;mismatched/unknown&lt;/bunknown&gt;');
    });
});
