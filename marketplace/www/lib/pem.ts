const PEM_REGEX = /-----BEGIN (RSA )?PUBLIC KEY-----[\s\S]+-----END (RSA )?PUBLIC KEY-----/;

export function validatePublicKeyPem(input: string) {
  if (!input) return false;
  const normalized = input.trim();
  return PEM_REGEX.test(normalized);
}
