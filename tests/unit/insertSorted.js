/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
const Util = imports.misc.util;
const CoreEnvironment = imports.misc.coreEnvironment;

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

describe('Sorted Inserter Utility', function() {
    beforeEach(function() {
        CoreEnvironment.coreInit();
    });
    it('inserts sorted integers with an integer comparator', function() {
        let arrayInt = [1, 2, 3, 5, 6];
        Util.insertSorted(arrayInt, 4, function(one, two) {
                                           return one - two
                                       });
        expect(arrayInt).toEqual([1, 2, 3, 4, 5, 6]);
    });
    it('inserts sorted integers where there is no comparator', function() {
        let arrayInt = [1, 2, 3, 4, 5, 6];
        Util.insertSorted(arrayInt, 3);
        expect(arrayInt).toEqual([1, 2, 3, 3, 4, 5, 6]);
    });
    it('inserts objects with property comparators', function() {
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
        expect(arrayObj).toEqual([obj1, obj2, obj3, obj4]);
    });
    it('does not call the comparator when inserting into an empty array', function() {
        let comparator = jasmine.createSpy ('Comparator Spy');
        let emptyArray = [];
        Util.insertSorted(emptyArray, 3, comparator);
        expect(comparator).not.toHaveBeenCalled();
    });
    it('does not invalidly accesss the array when we insert at the end of the array', function() {
        let array = [1];
        expect(function() {
                   Util.insertSorted(array, 4, checkedIntegerCmp);
                   Util.insertSorted(array, 5, checkedIntegerCmp);
               }).not.toThrow();
    });
    it('does not invalidly access the array when we insert the the beginning of the array', function() {
        let array = [1, 4, 5];
        expect(function() {
                   Util.insertSorted(array, 2, checkedIntegerCmp);
                   Util.insertSorted(array, 3, checkedIntegerCmp);
               }).not.toThrow();
    });
});
