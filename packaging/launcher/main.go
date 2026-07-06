// microsoft-rewards launcher
// Compiled with: GOOS=windows GOARCH=amd64 go build -ldflags="-s -w -H=windowsgui" -o microsoft-rewards.exe .
//
// At runtime this .exe:
//   1. Resolves the portable-package root (directory of the .exe itself)
//   2. Sets PLAYWRIGHT_BROWSERS_PATH so patchright finds Chromium
//   3. Downloads Chromium on first run via patchright CLI
//   4. Spawns node.exe dist/index.js with all args + I/O forwarded

package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	exeDir, err := resolveExeDir()
	if err != nil {
		fatal("Cannot determine executable location: " + err.Error())
	}

	nodeExe     := filepath.Join(exeDir, "node.exe")
	indexJS     := filepath.Join(exeDir, "dist", "index.js")
	browsersDir := filepath.Join(exeDir, "browsers")
	patchrightCLI := filepath.Join(exeDir, "node_modules", "patchright", "cli.js")

	checkExists(nodeExe, "node.exe is missing – the package may be corrupted.")
	checkExists(indexJS, "dist\\index.js is missing – the package may be corrupted.")
	checkExists(patchrightCLI, "node_modules\\patchright\\cli.js is missing – the package may be corrupted.")

	// Ensure config.json and accounts.json exist by copying from example templates if missing
	configJSON := filepath.Join(exeDir, "dist", "config.json")
	configExample := filepath.Join(exeDir, "dist", "config.example.json")
	accountsJSON := filepath.Join(exeDir, "dist", "accounts.json")
	accountsExample := filepath.Join(exeDir, "dist", "accounts.example.json")

	if !pathExists(configJSON) && pathExists(configExample) {
		fmt.Println("[First Run] Creating dist\\config.json from template...")
		if err := copyFile(configExample, configJSON); err != nil {
			fatal("Failed to copy config.json from template: " + err.Error())
		}
	}
	if !pathExists(accountsJSON) && pathExists(accountsExample) {
		fmt.Println("[First Run] Creating dist\\accounts.json from template...")
		if err := copyFile(accountsExample, accountsJSON); err != nil {
			fatal("Failed to copy accounts.json from template: " + err.Error())
		}
	}

	// First-run: install Chromium if browsers/ directory does not exist yet
	if !pathExists(browsersDir) {
		fmt.Println("[First Run] Downloading Chromium browser (~200 MB). This only happens once...")
		fmt.Println()

		install := exec.Command(nodeExe, patchrightCLI, "install", "chromium")
		install.Stdout = os.Stdout
		install.Stderr = os.Stderr
		install.Env = append(os.Environ(), "PLAYWRIGHT_BROWSERS_PATH="+browsersDir)

		if err := install.Run(); err != nil {
			fatal("Chromium installation failed: " + err.Error())
		}
		fmt.Println()
		fmt.Println("[First Run] Chromium installed successfully.")
		fmt.Println()
	}

	// Build args: node.exe dist/index.js [user-supplied args...]
	args := append([]string{indexJS}, os.Args[1:]...)

	cmd := exec.Command(nodeExe, args...)
	cmd.Stdin  = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env   = append(os.Environ(), "PLAYWRIGHT_BROWSERS_PATH="+browsersDir)

	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitWithPause(exitErr.ExitCode())
		}
		// Process was likely killed by a signal; exit silently
		exitWithPause(1)
	}
	exitWithPause(0)
}

func resolveExeDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return "", err
	}
	return filepath.Dir(exe), nil
}

func pathExists(p string) bool {
	_, err := os.Stat(p)
	return !os.IsNotExist(err)
}

func checkExists(p, msg string) {
	if !pathExists(p) {
		fmt.Fprintf(os.Stderr, "\nERROR: %s\nPath: %s\n\n", msg, p)
		exitWithPause(1)
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	if err != nil {
		return err
	}
	return out.Sync()
}


func exitWithPause(code int) {
	if isDoubleClicked() {
		fmt.Println()
		fmt.Println("Press Enter to exit...")
		reader := bufio.NewReader(os.Stdin)
		reader.ReadString('\n')
	}
	os.Exit(code)
}

func fatal(msg string) {
	fmt.Fprintf(os.Stderr, "\nERROR: %s\n\n", msg)
	exitWithPause(1)
}
