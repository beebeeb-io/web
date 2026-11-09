// Pure helpers for the account-delete second-factor step.

export function isPlausibleSecondFactorCode(code: string): boolean {
  return /^\d{6}$|^\d{8}$/.test(code.trim())
}

/** What a refused delete means for the flow: ask for the code again, or start over with the password. */
export function classifyDeleteError(
  status: number | undefined,
  code: string | undefined,
  message: string,
  codeSent = false,
): { restartStepUp: boolean; message: string; serverMessage?: string } {
  // A wrong code: the server already spent the password step-up on this try, so the next
  // try starts over from the password. The old token is never reused.
  if (status === 400 && codeSent) {
    return {
      restartStepUp: true,
      message: "That code didn't work. Confirm your password again to try once more.",
      serverMessage: message,
    }
  }
  if (status === 403 && code !== 'second_factor_required') {
    return { restartStepUp: true, message: 'Re-authentication expired. Enter your password again.' }
  }
  if (code === 'second_factor_required') {
    return { restartStepUp: false, message: 'Enter the code from your authenticator app, or a backup code.' }
  }
  return { restartStepUp: false, message }
}
