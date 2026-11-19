export type MobileRouteComputer = {
  relay?: string;
  endpoints: string[];
  lastEndpoint?: string;
};

/** Addresses the computer itself published. A remembered public relay is not a route. */
export function mobileConnectPlan(
  computer: MobileRouteComputer,
  discovered: string[] = [],
) {
  const relay = declaredRelay(computer.relay);
  const direct = computer.endpoints.filter((address) => connectable(address));
  const remembered =
    computer.lastEndpoint &&
    (computer.lastEndpoint === relay || direct.includes(computer.lastEndpoint))
      ? computer.lastEndpoint
      : undefined;
  const addresses = [
    ...new Set([
      ...(remembered ? [remembered] : []),
      ...direct,
      ...(relay ? [relay] : []),
      ...discovered.filter((address) => connectable(address)),
    ]),
  ];
  return { addresses, relay };
}

export function mobileRouteLabel(address: string, relay?: string) {
  const host = new URL(address).host;
  return address === relay ? "远程中继 " + host : "直接连接 " + host;
}

export function mobileConnectionFailure(triedRelay: boolean, triedDirect: boolean) {
  if (triedRelay && triedDirect)
    return "远程中继和直接连接都失败。请确认电脑已开机、手机连接已开启，并且手机能访问该中继或与电脑在同一网络。";
  if (triedRelay) return "已配置的远程中继没有连上，而且没有可用的直接地址。";
  return "没有连上电脑公布的直接地址。请确认电脑已开机并开启手机连接，且手机和电脑在同一网络。";
}

function connectable(address: string) {
  try {
    const url = new URL(address);
    return ["ws:", "wss:"].includes(url.protocol) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function declaredRelay(relay?: string) {
  return relay && connectable(relay) ? relay : undefined;
}
