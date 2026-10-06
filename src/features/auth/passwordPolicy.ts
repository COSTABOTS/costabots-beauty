export const PASSWORD_REQUIREMENTS = 'Mínimo 10 caracteres, con letras y números.';

export function isValidPassword(password: string) {
  return password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
}
