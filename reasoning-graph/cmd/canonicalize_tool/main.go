package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/ILLUVRSE/Main/reasoning-graph/internal/canonical"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage: canonicalize_tool <input.json>\n")
		os.Exit(1)
	}

	inputFile := os.Args[1]
	data, err := os.ReadFile(inputFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error reading file: %v\n", err)
		os.Exit(1)
	}

	var input interface{}
	if err := json.Unmarshal(data, &input); err != nil {
		fmt.Fprintf(os.Stderr, "Error parsing JSON: %v\n", err)
		os.Exit(1)
	}

	output, err := canonical.Canonicalize(input)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error canonicalizing: %v\n", err)
		os.Exit(1)
	}

	// Print raw bytes to stdout
	os.Stdout.Write(output)
}
