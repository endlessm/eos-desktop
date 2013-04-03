#!/usr/bin/env python

import os
import errno
import re

class DesktopWriter:

    def __init__(self, csv_path, desktop_dir):
        self._csv_path = csv_path
        self._desktop_dir = desktop_dir
        self.make_sure_path_exists(desktop_dir)

    def make_sure_path_exists(self, path):
        try:
            os.makedirs(path)
        except OSError as exception:
            if exception.errno != errno.EEXIST:
                raise

    def locale_string(self, locale):
        if locale == 'default':
            return ''
        else:
            return '[' + locale + ']'

    def locale_file(self, locale):
        if locale == 'default':
            return ''
        else:
            return '.' + locale

    def _write_key(self, desktop_file, fields, key):
        # Write a line for each localized version of the key
        for locale in self._locales:
            field = fields[self._indexes[key][locale]]
            # Other than the default, omit blank values
            if field or locale == 'default':
                line = '%s%s=%s\n' % (key, self.locale_string(locale), field)
                desktop_file.write(line)

    def _write_desktop_file(self, fields, locale, exec_string):
        desktop_id = fields[0]
        desktop_path = os.path.join(self._desktop_dir,
                                    desktop_id + self.locale_file(locale) +
                                    '.desktop')
        desktop_file = open(desktop_path, 'w')
        desktop_file.write('[Desktop Entry]\n')
        desktop_file.write('Version=1.0\n')
        self._write_key(desktop_file, fields, 'Name')
        self._write_key(desktop_file, fields, 'Comment')
        desktop_file.write('Type=Application\n')
        desktop_file.write('Exec=%s\n' % exec_string)
        self._write_key(desktop_file, fields, 'Icon')
        # Note: Categories is not localized
        desktop_file.write('Categories=%s\n' %
                           fields[self._indexes['Categories']['default']])

    def _add_index(self, key, locale, index):
        self._locales.add(locale)

        try:
            inner_dict = self._indexes[key]
        except:
            inner_dict = {}
        
        inner_dict[locale] = index
        self._indexes[key] = inner_dict

    def _parse_header(self, header):
        # Note: for now, the Desktop and AppStore columns are ignored
        # They will be used later to specify what is available by default
        # on the desktop and in the app store for each user personality

        # Set of all locales
        self._locales = set()

        # Dictionary that relates keys and locales to indexes
        self._indexes = {}

        # Find all the locales specified in the header
        locale_keys = ['Name', 'Comment', 'Exec', 'Icon', 'Categories']
        index = 0

        # For each field in the header
        fields = header.split(',')
        for field in fields:
            for key in locale_keys:
                if field.startswith(key):
                    if field == key:
                        # Non-localized field
                        locale = 'default'
                    else:
                        # Localized field
                        regex = '^' + key + '\[(.+)\]$'
                        match_result = re.match(regex, field)
                        if match_result:
                            locale = match_result.group(1)
                        else:
                            print 'Invalid localized field header:', field
                            exit(1)
                    self._add_index(key, locale, index)
            index += 1

    def write_desktop_files(self):
        csv_file = open(self._csv_path, 'r')

        # Parse the first line header
        header = csv_file.readline().rstrip()
        self._parse_header(header)

        # For each remaining line after the header
        for line in csv_file:
            fields = line.rstrip().split(',')
            name_id = fields[0]

            # Create a .desktop file for each localized Exec
            # (The desktop entry spec does not allow localized Exec strings
            # within a single .desktop file)
            for locale in self._locales:
                index = self._indexes['Exec'][locale]
                exec_string = fields[index]
                if exec_string:
                    self._write_desktop_file(fields, locale, exec_string)
    
        csv_file.close()

if __name__ == '__main__':
    desktop_writer = DesktopWriter('applications.csv', 'applications')
    desktop_writer.write_desktop_files()
