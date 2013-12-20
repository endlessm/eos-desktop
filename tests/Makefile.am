JS_TESTS = \
	unit/format_test.js				\
	unit/insertSorted_test.js			\
	unit/markup_test.js				\
	unit/jsParse_test.js				\
	unit/url_test.js

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
	interactive/box-shadow-animated.js	\
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
	$(JS_TESTS)

EXTRA_DIST = $(TEST_JS)

TEST_MISC =					\
	eos_harness_test/badextension.txt	\
	testcommon/test.css
EXTRA_DIST += $(TEST_MISC)

TESTS = \
  $(JS_TESTS) \
  $(NULL)
TEST_EXTENSIONS = .js
JASMINE_SUBMODULE_PATH = $(top_srcdir)/tests/jasmine

AM_JS_LOG_FLAGS = \
	--include-path=$(top_srcdir) \
	--include-path=$(top_srcdir)/js \
	--include-path=$(top_srcdir)/tests/unit

include $(JASMINE_SUBMODULE_PATH)/Makefile-jasmine.am.inc

LOG_COMPILER = gtester
AM_LOG_FLAGS = -k --verbose

# Use locally built versions of Shell-1.0 and libraries; this may need to
# be changed to AM_TESTS_ENVIRONMENT in a future version of Automake
TESTS_ENVIRONMENT = \
	GI_TYPELIB_PATH='$(top_builddir)/src:$(MUTTER_TYPELIB_DIR):${GI_TYPELIB_PATH}' \
	LD_LIBRARY_PATH='$(top_builddir)/src/:${GI_TYPELIB_PATH}' \
	$(NULL)

EXTRA_DIST += \
	README.txt
