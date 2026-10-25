/**
 * E-mails com a identidade da loja. Cada tipo tem o seu template e devolve as
 * duas versões: texto (vai junto, para cliente sem HTML) e HTML.
 *
 * Cliente de e-mail não é navegador: sem CSS externo, sem variável, sem SVG e
 * (no Gmail) sem fonte própria. Então: tabelas, estilo inline, a paleta de
 * globals.css repetida em hex, Michroma imitada com caixa alta e
 * espaçamento, e a assinatura como PNG (`public/email/lockup.png`, gerado da
 * mesma geometria do <Lockup>) com `alt` para quem bloqueia imagem.
 *
 * Todo valor que vem de fora (nome, descrição do orçamento) passa por
 * `escapeHtml`: o formulário de orçamento é público.
 */

import { formatPriceCents } from "@/lib/format";
import { CONTACT_EMAIL, SITE_URL } from "@/lib/site";

export type EmailContent = { subject: string; text: string; html: string };

const COLOR = {
  obsidian: "#0b0b0c",
  graphite: "#1f2023",
  ruleFaint: "#2a2b2f",
  bone: "#e7e3da",
  muted: "#8e9196",
  signal: "#c8102e",
};
const SANS = "'Inter Tight','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'IBM Plex Mono',SFMono-Regular,Menlo,Consolas,'Courier New',monospace";

export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Rótulo técnico: mono, caixa alta, espaçado (a `.label` do site). */
const label = (text: string, color = COLOR.muted) =>
  `<span style="font-family:${MONO};font-size:11px;line-height:16px;letter-spacing:3px;text-transform:uppercase;color:${color}">${escapeHtml(text)}</span>`;

/** Selo de estado: palavra num rótulo, não só cor (como no site). */
const chip = (text: string, tone: "bone" | "signal") =>
  `<span style="display:inline-block;padding:4px 10px;font-family:${MONO};font-size:11px;letter-spacing:2px;text-transform:uppercase;background:${tone === "bone" ? COLOR.bone : COLOR.signal};color:${tone === "bone" ? COLOR.obsidian : COLOR.bone}">${escapeHtml(text)}</span>`;

/** Botão primário: vermelho é a cor de AÇÃO da marca. */
const button = (text: string, href: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${COLOR.signal}"><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;font-family:${MONO};font-size:12px;letter-spacing:3px;text-transform:uppercase;color:${COLOR.bone};text-decoration:none">${escapeHtml(text)}</a></td></tr></table>`;

/** Linha de painel: rótulo à esquerda, valor à direita (o valor já vem em HTML). */
const row = (name: string, valueHtml: string, options: { strong?: boolean; first?: boolean } = {}) =>
  `<tr><td style="padding:12px 20px;${options.first ? "" : `border-top:1px solid ${COLOR.ruleFaint};`}font-family:${SANS};font-size:14px;color:${options.strong ? COLOR.bone : COLOR.muted};${options.strong ? "font-weight:600;" : ""}">${escapeHtml(name)}</td><td align="right" style="padding:12px 20px;${options.first ? "" : `border-top:1px solid ${COLOR.ruleFaint};`}font-family:${MONO};font-size:${options.strong ? "17px" : "14px"};color:${COLOR.bone};${options.strong ? "font-weight:700;" : ""}">${valueHtml}</td></tr>`;

/** Painel graphite com cabeçalho (identificador + selo), como o resumo do pedido no site. */
const panel = (id: string, chipHtml: string, rowsHtml: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.graphite};border:1px solid ${COLOR.ruleFaint}">
<tr><td style="padding:14px 20px;border-bottom:1px solid ${COLOR.ruleFaint};font-family:${MONO};font-size:12px;font-weight:700;letter-spacing:1px;color:${COLOR.bone}">${escapeHtml(id)}</td><td align="right" style="padding:14px 20px;border-bottom:1px solid ${COLOR.ruleFaint}">${chipHtml}</td></tr>
<tr><td colspan="2" style="padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table></td></tr>
</table>`;

function layout(input: {
  /** Texto escondido que o cliente mostra na lista, ao lado do assunto. */
  preheader: string;
  serial: string;
  eyebrow: string;
  title: string;
  lead: string;
  contentHtml: string;
  siteUrl: string;
}): string {
  const lockup = `${input.siteUrl}/email/lockup.png`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background:${COLOR.obsidian}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.obsidian}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="height:4px;background:${COLOR.signal};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:24px 0;border-bottom:1px solid ${COLOR.ruleFaint}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td><a href="${escapeHtml(input.siteUrl)}" style="text-decoration:none"><img src="${escapeHtml(lockup)}" width="158" height="28" alt="DYSTOPIA" style="display:block;border:0;font-family:${SANS};font-size:16px;letter-spacing:6px;color:${COLOR.bone}"></a></td>
    <td align="right">${label(input.serial)}</td>
  </tr></table>
</td></tr>
<tr><td style="padding:40px 0 8px">${label(input.eyebrow)}</td></tr>
<tr><td style="padding:0 0 16px;font-family:${SANS};font-size:28px;line-height:36px;letter-spacing:4px;text-transform:uppercase;color:${COLOR.bone}">${escapeHtml(input.title)}</td></tr>
<tr><td style="padding:0 0 32px;font-family:${SANS};font-size:15px;line-height:24px;color:${COLOR.muted}">${escapeHtml(input.lead)}</td></tr>
<tr><td>${input.contentHtml}</td></tr>
<tr><td style="padding:40px 0 0;border-bottom:1px solid ${COLOR.ruleFaint}"></td></tr>
<tr><td style="padding:20px 0;font-family:${MONO};font-size:11px;line-height:18px;letter-spacing:1px;color:${COLOR.muted}">
  DYS-0001 / SETOR 04 — Projeto de portfólio de Flávio Victor. Nenhum valor foi cobrado.<br>
  Contato: <a href="mailto:${CONTACT_EMAIL}" style="color:${COLOR.bone};text-decoration:underline">${CONTACT_EMAIL}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

const PAYMENT_LABELS: Record<string, string> = { pix: "Pix", boleto: "Boleto", credit_card: "Cartão", paypal: "PayPal" };

export type OrderConfirmationEmailInput = {
  orderNumber: string;
  customerName: string;
  totalCents: number;
  paymentMethod?: string;
  items: Array<{ name: string; quantity: number; unitPriceCents?: number }>;
};

export function orderConfirmationEmail(input: OrderConfirmationEmailInput, siteUrl: string = SITE_URL): EmailContent {
  // Voz da marca: declarativa, sem exclamação.
  const subject = `Aquisição ${input.orderNumber} registrada`;
  const orderUrl = `${siteUrl}/pedido/${encodeURIComponent(input.orderNumber)}`;
  const payment = input.paymentMethod ? PAYMENT_LABELS[input.paymentMethod] ?? input.paymentMethod : null;

  const text = [
    `${input.customerName}.`,
    "",
    `A aquisição ${input.orderNumber} foi registrada. O pagamento foi aprovado.`,
    ...input.items.map((item) => `- ${item.quantity}x ${item.name}`),
    "",
    `Total: ${formatPriceCents(input.totalCents)}`,
    ...(payment ? [`Pagamento: ${payment}`] : []),
    "",
    `Acompanhe em ${orderUrl}`,
    "Guarde este número. O pedido fica registrado na sua conta.",
  ].join("\n");

  const itemRows = input.items
    .map((item, index) => {
      const each = item.unitPriceCents === undefined ? "" : ` × ${formatPriceCents(item.unitPriceCents)}`;
      const lineTotal = item.unitPriceCents === undefined ? "" : formatPriceCents(item.unitPriceCents * item.quantity);
      return `<tr><td style="padding:14px 20px;${index === 0 ? "" : `border-top:1px solid ${COLOR.ruleFaint};`}font-family:${SANS};font-size:14px;line-height:20px;color:${COLOR.bone}">${escapeHtml(item.name)}<br><span style="font-size:12px;color:${COLOR.muted}">${item.quantity}${escapeHtml(each)}</span></td><td align="right" valign="top" style="padding:14px 20px;${index === 0 ? "" : `border-top:1px solid ${COLOR.ruleFaint};`}font-family:${MONO};font-size:14px;color:${COLOR.bone}">${escapeHtml(lineTotal)}</td></tr>`;
    })
    .join("");
  const summaryRows =
    (payment ? row("Pagamento", escapeHtml(payment)) : "") +
    row("Total", escapeHtml(formatPriceCents(input.totalCents)), { strong: true });

  const html = layout({
    preheader: `Pagamento aprovado. Total ${formatPriceCents(input.totalCents)}.`,
    serial: "Protocolo de compra",
    eyebrow: `Pedido / ${input.orderNumber}`,
    title: "Aquisição registrada.",
    lead: `${input.customerName}. O pagamento foi aprovado e o equipamento está reservado. O despacho segue o protocolo.`,
    contentHtml: `${panel(input.orderNumber, chip("Pago", "bone"), itemRows + summaryRows)}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td>${button("Ver pedido", orderUrl)}</td></tr></table>
<p style="margin:20px 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${COLOR.muted}">Guarde este número. O pedido fica registrado na sua conta.</p>`,
    siteUrl,
  });

  return { subject, text, html };
}

export type ServiceRequestAlertEmailInput = {
  protocol: string;
  serviceName: string;
  name: string;
  email: string;
  phone: string | null;
  details: string;
};

export function serviceRequestAlertEmail(input: ServiceRequestAlertEmailInput, siteUrl: string = SITE_URL): EmailContent {
  const subject = `Orçamento ${input.protocol}: ${input.serviceName}`;
  const adminUrl = `${siteUrl}/admin/orcamentos`;

  const text = [
    `Nova solicitação registrada: ${input.protocol}.`,
    "",
    `Serviço: ${input.serviceName}`,
    `Nome: ${input.name}`,
    `E-mail: ${input.email}`,
    `Telefone: ${input.phone ?? "não informado"}`,
    "",
    input.details,
    "",
    `Andamento em ${adminUrl}`,
  ].join("\n");

  const mailto = `mailto:${input.email}?subject=${encodeURIComponent(`Orçamento ${input.protocol}`)}`;
  const rows =
    row("Serviço", escapeHtml(input.serviceName), { first: true }) +
    row("Nome", escapeHtml(input.name)) +
    row("E-mail", `<a href="${escapeHtml(mailto)}" style="color:${COLOR.bone};text-decoration:underline">${escapeHtml(input.email)}</a>`) +
    row("Telefone", escapeHtml(input.phone ?? "não informado"));

  const html = layout({
    preheader: `${input.serviceName} — ${input.name}`,
    serial: "Orçamento",
    eyebrow: `Orçamento / ${input.protocol}`,
    title: "Solicitação registrada.",
    lead: `${input.name} pediu um orçamento de ${input.serviceName.toLowerCase()}. Responda por e-mail ou acompanhe no painel.`,
    contentHtml: `${panel(input.protocol, chip("Novo", "signal"), rows)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px"><tr><td style="padding:16px 20px;border-left:2px solid ${COLOR.signal};background:${COLOR.graphite}">
  ${label("Descrição")}
  <p style="margin:8px 0 0;font-family:${SANS};font-size:14px;line-height:22px;color:${COLOR.bone};white-space:pre-wrap">${escapeHtml(input.details)}</p>
</td></tr></table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td>${button("Abrir no painel", adminUrl)}</td><td style="padding-left:20px"><a href="${escapeHtml(mailto)}" style="font-family:${MONO};font-size:12px;letter-spacing:3px;text-transform:uppercase;color:${COLOR.bone};text-decoration:underline">Responder</a></td></tr></table>`,
    siteUrl,
  });

  return { subject, text, html };
}
