import type { OfferedTime } from './bookingTypes.ts';

export const bookingReplies = {
  greeting: 'Hola. ¿En qué puedo ayudarte?',
  askService: '¿Qué servicio te gustaría reservar?',
  askDate: '¿Qué día te vendría bien?',
  clarifyDate: 'No he podido reconocer el día. Puedes decirme lunes, mañana o una fecha como 5 de agosto.',
  clarify: 'No lo he entendido del todo. ¿Puedes decírmelo de otra forma?',
  lowConfidence: 'Quiero asegurarme de entenderte bien. ¿Qué servicio, día u hora prefieres?',
  expired: 'Los horarios que te mostré ya han caducado. Dime qué día prefieres y los consulto de nuevo.',
  unavailable: 'Ese horario acaba de dejar de estar disponible. Te muestro las opciones actualizadas.',
  noAvailability: 'No encuentro huecos para ese día. ¿Quieres que pruebe otra fecha?',
  chooseOfferedTime: 'Esa hora no está entre las opciones disponibles. Elige uno de los horarios que te he mostrado.',
  chooseAnotherDate: 'No tengo horarios disponibles cargados para ese día. Puedes indicarme otra fecha.',
  clarifyTime: 'No he entendido qué horario prefieres.',
  chooseTimeBeforeConfirming: 'Antes de confirmar necesito que elijas uno de los horarios disponibles.',
  cancelled: 'De acuerdo, no continuamos con esta solicitud. Si necesitas otra cosa, aquí estoy.',
  handoff: 'Perfecto. La cita todavía no está confirmada. Una persona del negocio la finalizará contigo.',
  humanRequested: 'De acuerdo. Te atenderá una persona del negocio en cuanto sea posible.',
};

export function timeClarificationReply(options: OfferedTime[]) {
  if (!options.length) return bookingReplies.chooseAnotherDate;
  return `${bookingReplies.clarifyTime} Puedes elegir: ${options.map((option) => option.label).join(', ')}.`;
}

export function unavailableTimeReply(options: OfferedTime[]) {
  if (!options.length) return bookingReplies.chooseAnotherDate;
  return `Esa hora no está entre las opciones disponibles. Puedes elegir: ${options.map((option) => option.label).join(', ')}.`;
}

export function askDateForService(serviceName: string | null, greeting = true) {
  return serviceName
    ? `${greeting ? 'Hola. ' : ''}¿Qué día te vendría bien para el ${serviceName.toLocaleLowerCase('es')}?`
    : bookingReplies.askDate;
}

export function availabilityReply(dateLabel: string, options: OfferedTime[]) {
  const labels = options.map((option) => option.label);
  const joined = labels.length <= 1
    ? labels[0] ?? ''
    : `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`;
  return `Para ${dateLabel} tengo estos horarios disponibles: ${joined}. ¿Cuál te viene mejor?`;
}

export function selectionReply(dateLabel: string, time: string) {
  return `Has elegido ${dateLabel} a las ${time}. ¿Quieres que una persona del negocio confirme la cita?`;
}
