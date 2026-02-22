#!/usr/bin/env bun

const VERSION = "0.1.0";

function printHelp(): void {
  console.log(`rain ${VERSION}

Usage:
  rain <command> [options]

Commands:
  help                  Show this help
  version               Show CLI version
  robot-docs            Placeholder for machine-readable schema output

Global options:
  -h, --help            Show help
  -v, --version         Show version
`);
}

function printVersion(): void {
  console.log(VERSION);
}

function printTodo(command: string): void {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: {
          code: "NOT_IMPLEMENTED",
          message: `Command "${command}" is not implemented yet.`,
          suggest: ["Run `rain help` to see currently available commands."]
        }
      },
      null,
      2
    )
  );
  process.exitCode = 2;
}

function run(argv: string[]): void {
  const [command] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    printVersion();
    return;
  }

  if (command === "robot-docs") {
    console.log(
      JSON.stringify(
        {
          ok: true,
          data: {
            name: "rain",
            version: VERSION,
            status: "bootstrap",
            message: "Initial CLI scaffold is in place. Full schema to be implemented."
          }
        },
        null,
        2
      )
    );
    return;
  }

  printTodo(command);
}

run(process.argv.slice(2));
