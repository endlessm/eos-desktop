// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;

const FixType = {
    CONVERT : true,
    ESCAPE : false
};

// fixMarkup:
// @text: some text with markup
// @allowMarkup: whether or not to parse markup characters in this text
//
// Escapes all invalid markup or all markup if markup is not allowed.
function fixMarkup(text, allowMarkup) {
    if (allowMarkup == FixType.CONVERT) {
        // Support &amp;, &quot;, &apos;, &lt; and &gt;, escape all other
        // occurrences of '&'.
        let _text = text.replace(/&(?!amp;|quot;|apos;|lt;|gt;)/g, '&amp;');

        // Support <b>, <i>, and <u>, escape anything else
        // so it displays as raw markup.
        _text = _text.replace(/<(?!\/?[biu]>)/g, '&lt;');

        try {
            Pango.parse_markup(_text, -1, '');
            return _text;
        } catch (e) {}
    }

    // !allowMarkup, or invalid markup
    return GLib.markup_escape_text(text, -1);
}
