// Task 1590 — a tiny module for the mockModuleScoped() self-test pair
// (1590-scoped-mock-a-victim / 1590-scoped-mock-b-mocker). Not a test file.
export function who(): string {
  return 'real'
}
export function untouched(): string {
  return 'real-untouched'
}
