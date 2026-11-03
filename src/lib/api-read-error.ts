/** Read the server's error string from a non-ok response. */
export async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    return body.error ?? body.message ?? res.statusText
  } catch {
    return res.statusText
  }
}
