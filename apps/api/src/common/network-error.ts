/**
 * Turns a failed connection (fetch, nodemailer) into a sentence an operator can act on: what happened, in words,
 * the system code, and the usual fix for a SampForce server running in Docker. Used by the console's connection
 * tests and the AI adapters, where "could not be reached" alone left people guessing.
 */

/** The system error code of a failed connection: fetch keeps it on `cause`, nodemailer on the error itself. */
export function networkCode(err: unknown): string | null {
  const seen = new Set<unknown>();
  let e: unknown = err;
  while (e && typeof e === 'object' && !seen.has(e)) {
    seen.add(e);
    const o = e as { code?: unknown; errno?: unknown; cause?: unknown; message?: unknown };
    if (typeof o.code === 'string' && /^(E[A-Z_]+|UND_ERR_[A-Z_]+)$/.test(o.code) && o.code !== 'ECONNECTION' && o.code !== 'ESOCKET') return o.code;
    // nodemailer wraps socket errors as ECONNECTION / ESOCKET with the real code in the message.
    if (typeof o.message === 'string') {
      const m = o.message.match(/\b(ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|EADDRNOTAVAIL)\b/);
      if (m) return m[1]!;
    }
    e = o.cause;
  }
  return null;
}

const isIpv6Host = (host: string) => host.startsWith('[') || host.includes(':');
const isLoopback = (host: string) => /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i.test(host);

/**
 * Why a host could not be reached, with the fix. `host` is the host name or address that was dialled (IPv6 in
 * brackets or not), `port` the port, `what` the subject of the sentence ("The AI server", "The email service").
 */
export function explainNetworkError(err: unknown, what: string, host: string, port: string | number): string {
  const code = networkCode(err);
  const where = `${host}${port ? ` port ${port}` : ''}`;
  if (isLoopback(host)) {
    return `${what} could not be reached at ${where}${code ? ` (${code})` : ''}. Inside SampForce's containers, localhost is the container itself, not the server: use http://host.docker.internal:<port> for something running on the server, or the service name (http://ollama:11434/v1) for a container next to SampForce.`;
  }
  switch (code) {
    case 'ENETUNREACH':
    case 'EHOSTUNREACH':
    case 'EADDRNOTAVAIL':
      return isIpv6Host(host)
        ? `${what} could not be reached at ${where} (${code}): SampForce's containers have no IPv6 route, which is Docker's default. Use an IPv4 address or host name, http://host.docker.internal:<port> for something on this server, or http://ollama:11434/v1 for the Ollama container.`
        : `${what} could not be reached at ${where} (${code}): there is no network route from this server to that address. Check the address, and that it is not a private address of another network.`;
    case 'ECONNREFUSED':
      return `${what} refused the connection at ${where} (ECONNREFUSED): nothing is listening there. Check the port, and that the service listens on all addresses, not only on 127.0.0.1 (for Ollama, set OLLAMA_HOST=0.0.0.0).`;
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return `${what} did not answer at ${where} (${code}): a firewall is most likely dropping the connection. Allow that port from this server (on the target machine, and in the cloud provider's firewall or security group).`;
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `${what} could not be found: the name ${host} does not resolve (${code}). Check the spelling, or use the address.`;
    case 'ECONNRESET':
      return `${what} at ${where} closed the connection (ECONNRESET). Check that the address uses the right scheme (http or https) and port.`;
    default:
      return `${what} could not be reached at ${where}${code ? ` (${code})` : ''}. Check the address and that the server is running.`;
  }
}

/** Host and port of a URL as they were dialled (an IPv6 address keeps its brackets). */
export function hostAndPort(url: string): { host: string; port: string } {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port || (u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '') };
  } catch {
    return { host: url, port: '' };
  }
}
