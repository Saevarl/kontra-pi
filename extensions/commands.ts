export const KONTRA_COMMANDS = ["status", "rules", "sources", "doctor", "gate", "help"] as const;
export type KontraCommand = typeof KONTRA_COMMANDS[number];

export function parseKontraCommand(input: string): KontraCommand | undefined {
  const value = input.trim() || "status";
  return KONTRA_COMMANDS.find((command) => command === value);
}
