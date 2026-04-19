export function generateMissionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `gamma-exp-${timestamp}-${random}`;
}
