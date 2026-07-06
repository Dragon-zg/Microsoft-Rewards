//go:build windows
// +build windows

package main

import (
	"syscall"
	"unsafe"
)

func isDoubleClicked() bool {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	getConsoleProcessList := kernel32.NewProc("GetConsoleProcessList")

	var processList [2]uint32
	r1, _, _ := getConsoleProcessList.Call(
		uintptr(unsafe.Pointer(&processList[0])),
		uintptr(len(processList)),
	)
	// If r1 <= 2, it means this console window was created for our executable
	// (usually microsoft-rewards.exe and conhost.exe are the only processes in it).
	return r1 <= 2
}
