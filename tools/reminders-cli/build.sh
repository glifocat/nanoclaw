#!/bin/bash
# Build the reminders-cli Swift binary (macOS only, requires Xcode CLT)
set -e
cd "$(dirname "$0")"
swiftc -O -o reminders-cli reminders-cli.swift
echo "Built: $(pwd)/reminders-cli"
