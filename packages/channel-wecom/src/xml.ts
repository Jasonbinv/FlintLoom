export type WecomInboundMessage = {
  fromUser: string;
  content: string;
  msgId: string;
  agentId?: string;
};

function cdataValue(xml: string, tag: string): string | undefined {
  const cdata = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  const plain = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const cdataMatch = cdata.exec(xml);
  if (cdataMatch?.[1] !== undefined) {
    return cdataMatch[1];
  }
  const plainMatch = plain.exec(xml);
  return plainMatch?.[1];
}

export function parseWecomInboundXml(xml: string): WecomInboundMessage | undefined {
  const msgType = cdataValue(xml, "MsgType");
  if (msgType !== "text") {
    return undefined;
  }
  const fromUser = cdataValue(xml, "FromUserName");
  const content = cdataValue(xml, "Content");
  const msgId = cdataValue(xml, "MsgId");
  if (
    fromUser === undefined ||
    content === undefined ||
    msgId === undefined ||
    fromUser.length === 0 ||
    content.trim().length === 0
  ) {
    return undefined;
  }
  return {
    fromUser,
    content: content.trim(),
    msgId,
    agentId: cdataValue(xml, "AgentID"),
  };
}

export function parseWecomEncryptXml(xml: string): string | undefined {
  return cdataValue(xml, "Encrypt");
}
