#!/usr/bin/gjs

imports.searchPath.unshift ("jasmine");
imports.searchPath.unshift (".");
imports.searchPath.unshift ("../js");

const JasmineGJS = imports.jasminegjsbootstrap;
JasmineGJS.bootstrap ("jasmine");

let suites = [];

ARGV.forEach (function (arg) {
  suites.push (arg);
});

JasmineGJS.executeSpecs (suites, "");
