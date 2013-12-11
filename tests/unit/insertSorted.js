/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// Test cases for Util.insertSorted

const JsUnit = imports.jsUnit;
const Util = imports.misc.util;

const Environment = imports.misc.coreEnvironment;
Environment.coreInit();

function assertArrayEquals(array1, array2) {
    JsUnit.assertEquals('Array lengths are not equal',
                        array1.length, array2.length);
    for (let j = 0; j < array1.length; j++) {
        JsUnit.assertEquals('Array item ' + j + ' is not equal',
                            array1[j], array2[j]);
    }
}

function cmp(one, two) {
    return one - two;
}

function testInsertIntegerWithComparator() {
    let arrayInt = [1, 2, 3, 5, 6];
    Util.insertSorted(arrayInt, 4, function(one, two) {
                                       return one - two
                                   });
    assertArrayEquals([1, 2, 3, 4, 5, 6], arrayInt);
}

// no comparator, integer sorting is implied
function testInsertIntegerWithoutComparator() {
    let arrayInt = [1, 2, 3, 4, 5, 6];
    Util.insertSorted(arrayInt, 3);
    assertArrayEquals([1, 2, 3, 3, 4, 5, 6], arrayInt);
}

function testInsertObjectWithPropertyComparator() {
    let obj1 = { a: 1 };
    let obj2 = { a: 2, b: 0 };
    let obj3 = { a: 2, b: 1 };
    let obj4 = { a: 3 };

    let arrayObj = [obj1, obj3, obj4];

    // obj2 compares equivalent to obj3, should be
    // inserted before
    Util.insertSorted(arrayObj, obj2, function(one, two) {
                                          return one.a - two.a
                                      });
    assertArrayEquals([obj1, obj2, obj3, obj4], arrayObj);
}

// check that no comparisons are made when
// inserting in a empty array
function testInsertingIntoEmptyArrayDoesNotCallComparator() {
    let emptyArray = [];
    Util.insertSorted(emptyArray, 3, function() {
                                         throw "Comparator should not be called"
                                     });
}


/* If we access past the end of an array, then the types of
 * either one or two will not be a number and this comparator
 * will throw */
function checkedIntegerCmp(one, two) {
    if (typeof one != 'number' ||
        typeof two != 'number')
        throw new TypeError('Invalid type passed to checkedIntegerCmp ' +
                            'this is most likely caused by the fact that ' +
                            'the function calling this one accessed an array ' +
                            'out of bounds');

    return one - two;
}

// Insert at the end and check that we don't
// access past it
function testInsertingAndEndOfArrayDoesNotCauseInvalidAccess() {
    let array = [1];
    Util.insertSorted(array, 4, checkedIntegerCmp);
    Util.insertSorted(array, 5, checkedIntegerCmp);
}


function testInsertingAtBeginningOfArrayDoesNotCauseInvalidAccess() {
    let array = [1, 4, 5];
    Util.insertSorted(array, 2, checkedIntegerCmp);
    Util.insertSorted(array, 1, checkedIntegerCmp);
}
