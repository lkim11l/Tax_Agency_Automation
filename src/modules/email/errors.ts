export function safeOperationalError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("auth") || message.includes("password") || message.includes("credential")) {
    return "Mailbox authentication failed. Verify the external-app credentials.";
  }
  if (message.includes("tls") || message.includes("certificate")) {
    return "Secure mailbox connection failed during TLS negotiation.";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "Mailbox connection timed out.";
  }
  if (
    message.includes("econnrefused") ||
    message.includes("connection refused")
  ) {
    return "Mailbox server refused the connection.";
  }
  if (
    message.includes("enotfound") ||
    message.includes("getaddrinfo") ||
    message.includes("dns")
  ) {
    return "Mailbox server name could not be resolved.";
  }
  if (
    message.includes("unexpected") ||
    message.includes("wrong version number") ||
    message.includes("greeting")
  ) {
    return "Mailbox protocol or secure-port configuration is invalid.";
  }
  if (message.includes("mime") || message.includes("sender address")) {
    return "The email MIME content could not be parsed safely.";
  }
  if (message.includes("storage") || message.includes("bucket")) {
    return "Attachment storage failed.";
  }
  if (message.includes("environment variable")) {
    return error instanceof Error ? error.message : "Email configuration is incomplete.";
  }
  return "Email processing failed. Review the server diagnostics.";
}
