#!/bin/bash

if [[ $# -ne 2 ]]; then
  echo "Usage $0 <old id> <new_id>"
fi

echo "Changing $1 to $2"
sed -i "s/msgid \"$1\"/msgid \"$2\"/g" ./*.po 
