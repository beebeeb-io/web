// Pure helpers for the account-delete second-factor step.

export function isPlausibleSecondFactorCode(code: string): boolean {
  return /^\d{6}$|^\d{8}$/.test(code.trim())
}

/** What a refused delete means for the flow: ask for the code again, or start over with the password. */
export function classifyDeleteError(
  status: number | undefined,
  code: string | undefined,
  message: string,
): { restartStepUp: boolean; message: string } {
  if (status === 403 && code !== 'second_factor_required') {
    return { restartStepUp: true, message: 'Re-authentication expired. Enter your password again.' }
  }
  if (code === 'second_factor_required') {
    return { restartStepUp: false, message: 'Enter the code from your authenticator app, or a backup code.' }
  }
  return { restartStepUp: false, message }
}
