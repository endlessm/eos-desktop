// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/*
 * Test cases for the Format module
 */

const JsUnit = imports.jsUnit;
const assertEquals = JsUnit.assertEquals;
const assertRaises = JsUnit.assertRaises;

const CoreEnvironment = imports.misc.coreEnvironment;
const Format = imports.format;

// Test common usage and %% handling

describe ('String Format', function () {
    beforeEach(function() {
        CoreEnvironment.coreInit();
    });

    it ('can insert simple strings', function () {
        expect ('%s'.format ('foo')).toMatch ('foo');
    });
    it ('does not insert a string when % preceeds %s', function () {
        expect ('%%s'.format ('foo')).toMatch ('%s');
    });
    it ('replaces %% with %', function () {
        expect ('%%%%s'.format ('foo')).toMatch ('%%s');
    });
    it ('inserts strings and integers', function () {
        expect ('%s %d'.format ('foo', 5)).toMatch ('foo 5');
    });
    it ('inserts integers', function () {
        expect ('%d'.format (8)).toMatch ('8');
    });
    it ('inserts ascii format codes', function () {
        expect ('%x'.format (15)).toMatch ('f');
    });
    it ('inserts floating point numbers with precision', function () {
        expect ('%f %.2f'.format (2.58, 6.958)).toMatch ('2.58 6.96');
    });
    it ('inserts integers and strings with field with', function () {
        expect ('%03d %4s'.format (7, 'foo')).toMatch ('007  foo');
    });
    it ('inserts floating point number with a field with', function () {
        expect ('%5f %05.2f'.format (2.58, 6.958)).toMatch (' 2.58 06.96');
    });
    it ('strips 0x from hex numbers', function () {
        expect ('%2x'.format (0xcafe)).toMatch ('cafe');
    });
    it ('does not strip characters even if width is zero', function () {
        expect ('%0s'.format ('foo')).toMatch ('foo');
    });
    it ('throws an exception if we attempt to use precision for integers', function () {
        expect (function () {
            '%2.d'.format (5.21);
        }).toThrow ();
    });
    it ('throws an exception on the wrong conversion character', function () {
        expect (function () {
                    '%s is 50% done'.format('foo');
                }).toThrow ();
    });
});
