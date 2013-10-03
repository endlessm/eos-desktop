noinst_SCRIPTS = run-test.sh
EXTRA_DIST = run-test.sh.in

TEST_JS =					\
	jenkinsTestPlugin.js			\
	eos_harness_test/subdir/testbar.js	\
	eos_harness_test/testNoSetupOrTearDown.js \
	eos_harness_test/testbar.js		\
	eos_harness_test/testfoo.js		\
	interactive/background-repeat.js	\
	interactive/background-size.js		\
	interactive/borders.js			\
	interactive/border-radius.js		\
	interactive/border-width.js		\
	interactive/box-layout.js		\
	interactive/box-shadows.js		\
	interactive/calendar.js			\
	interactive/css-fonts.js		\
	interactive/entry.js			\
	interactive/gapplication.js		\
	interactive/icons.js			\
	interactive/inline-style.js		\
	interactive/scrolling.js		\
	interactive/scroll-view-sizing.js	\
	interactive/table.js			\
	interactive/test-title.js		\
	interactive/transitions.js		\
	js/ui/sessionModeTest.js		\
	testcommon/100-200.svg			\
	testcommon/200-100.svg			\
	testcommon/200-200.svg			\
	testcommon/border-image.png		\
	testcommon/face-plain.png		\
	testcommon/ui.js                        \
	test_example/foo_test.js		\
	test_example/some_class.js		\
	unit/format.js				\
	unit/insertSorted.js			\
	unit/markup.js				\
	unit/jsParse.js				\
	unit/url.js
EXTRA_DIST += $(TEST_JS)

TEST_MISC =					\
	eos_harness_test/badextension.txt	\
	testcommon/test.css
EXTRA_DIST += $(TEST_MISC)

run-test.sh: run-test.sh.in
	$(AM_V_GEN) sed \
	    -e "s|@MUTTER_TYPELIB_DIR[@]|$(MUTTER_TYPELIB_DIR)|" \
	    -e "s|@srcdir[@]|$(srcdir)|" \
	    $< > $@ && chmod a+x $@

EXTRA_DIST += \
	README.txt \
	run-gjs-tests

CLEANFILES = run-test.sh
