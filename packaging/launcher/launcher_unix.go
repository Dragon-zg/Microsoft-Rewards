//go:build !windows
// +build !windows

package main

func isDoubleClicked() bool {
	// Double-clicking console-close concerns are Windows-specific.
	// Always return false on macOS/Linux.
	return false
}
