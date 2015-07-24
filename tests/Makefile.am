JS_TESTS = \
	js/ui/sessionModeTest.js			\
	unit/format_test.js				\
	unit/insertSorted_test.js			\
	unit/markup_test.js				\
	unit/jsParse_test.js				\
	unit/url_test.js

TEST_JS =					\
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
	testcommon/100-200.svg			\
	testcommon/200-100.svg			\
	testcommon/200-200.svg			\
	testcommon/border-image.png		\
	testcommon/face-plain.png		\
	testcommon/ui.js                        \
	$(JS_TESTS)

EXTRA_DIST = $(TEST_JS)

TEST_MISC =					\
	testcommon/test.css
EXTRA_DIST += $(TEST_MISC)

TESTS = \
  $(JS_TESTS) \
  run_coverage.coverage \
  $(NULL)
TEST_EXTENSIONS = .js .coverage

@EOS_COVERAGE_RULES@

# Pass resource paths to EOS_JS_COVERAGE_FILES
EOS_JS_COVERAGE_FILES = $(shell python -c "import xml.etree.ElementTree as ET; import sys; tree = ET.parse(\"$(abspath $(abs_top_srcdir)/js/js-resources.gresource.xml)\"); map(sys.stdout.write, ['resource:///org/gnome/shell/{0}\n'.format(e.text) for e in tree.getroot()[0]])")

JS_LOG_DRIVER = env AM_TAP_AWK='$(AWK)' $(SHELL) $(top_srcdir)/config/tap-driver.sh
JS_LOG_DRIVER_FLAGS = --comments
# run-js-test is a binary that is linked to libeos-shell and runs a GJS script;
# libst isn't built as a shared library, so it's impossible to import the St-1.0
# typelib directly from GJS. Unfortunately, this means we can't run tests by
# just typing "jasmine" - we need the ./jasmine script.
JS_LOG_COMPILER = $(top_builddir)/src/run-js-test
AM_JS_LOG_FLAGS = \
	@EOS_JS_COVERAGE_LOG_FLAGS@ \
	$(JASMINE) \
	--tap \
	@JASMINE_REPORT_ARGUMENT@

LOG_COMPILER = gtester
AM_LOG_FLAGS = -k --verbose

# Use locally built versions of Shell-1.0 and libraries; this may need to
# be changed to AM_TESTS_ENVIRONMENT in a future version of Automake
TESTS_ENVIRONMENT = \
	export GJS_PATH='$(top_srcdir):$(top_srcdir)/js:$(top_srcdir)/tests/unit'; \
	export GI_TYPELIB_PATH='$(top_builddir)/src:$(top_builddir)/src/gvc:$(MUTTER_TYPELIB_DIR):${GI_TYPELIB_PATH}'; \
	export LD_LIBRARY_PATH='$(top_builddir)/src/:${GI_TYPELIB_PATH}'; \
	export GSETTINGS_SCHEMA_DIR='$(top_builddir)/data'; \
	$(NULL)

EXTRA_DIST += \
	README.txt

clean-run-coverage:
	rm -rf $(abs_top_builddir)/tests/run_coverage.coverage

clean-local: clean-coverage clean-run-coverage
