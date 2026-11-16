import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Smartphone, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { api, explain } from "./api";
export function MobileSettings() {
  const [data, setData] = useState<any>(),
    [invite, setInvite] = useState<any>(),
    [qr, setQr] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [relayUrl, setRelayUrl] = useState(""),
    [relayToken, setRelayToken] = useState("");
  const [now, setNow] = useState(Date.now());
  const load = async () => {
    try {
      const v = await api.mobileSettings();
      setData(v);
    } catch (e) {
      setError(explain(e));
    }
  };
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 3000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(id);
      clearInterval(clock);
    };
  }, []);
  const change = async (input: any) => {
    setBusy(true);
    setError("");
    try {
      const v = await api.changeMobileSettings(input);
      if (v.payload) {
        setInvite(v);
        setQr(
          await QRCode.toDataURL(v.link, {
            width: 256,
            margin: 2,
            errorCorrectionLevel: "M",
          }),
        );
      } else {
        setData(v);
        setInvite(undefined);
        setQr("");
      }
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };
  const showCode = async () => {
    setBusy(true);
    setError("");
    try {
      if (!data.enabled)
        setData(await api.changeMobileSettings({ action: "enable" }));
      const next = await api.changeMobileSettings({ action: "invite" });
      const image = await QRCode.toDataURL(next.link, {
        width: 256,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      setInvite(next);
      setQr(image);
      setNow(Date.now());
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };
  const expiresAt = invite?.payload?.expiresAt ?? 0;
  const expired = !!invite && now >= expiresAt;
  return (
    <section>
      <h2>
        <Smartphone size={22} /> 手机连接
      </h2>
      <p className="settings-description">
        在手机上继续会话、查看产物和处理审批。首次连接请让手机和电脑使用同一
        Wi-Fi，并保持电脑唤醒。
      </p>
      <ol className="mobile-pairing-steps">
        <li>
          <b>1</b>显示二维码
        </li>
        <li>
          <b>2</b>手机 KTeam 扫码
        </li>
        <li>
          <b>3</b>在此确认连接
        </li>
      </ol>
      {error && (
        <p role="alert" className="flow-error">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={busy || !data}
        onClick={() => void showCode()}
      >
        <QrCode size={18} />
        {invite ? "刷新配对二维码" : "显示配对二维码"}
      </button>
      {data?.enabled && (
        <>
          <div className="settings-toolbar">
            <button
              className="icon-button"
              aria-label="刷新手机状态"
              onClick={() => void load()}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {invite && (
            <div className="mobile-pairing">
              {!expired && (
                <img width={256} height={256} src={qr} alt="手机配对二维码" />
              )}
              <p role="status">
                {expired
                  ? "二维码已过期，请刷新后再扫描。"
                  : `打开手机 KTeam，点“扫码连接电脑”。二维码还剩 ${Math.max(0, Math.ceil((expiresAt - now) / 1000))} 秒。`}
              </p>
              {!expired && (
                <details>
                  <summary>手动配对链接</summary>
                  <textarea
                    aria-label="配对链接"
                    readOnly
                    value={invite.link}
                  />
                </details>
              )}
            </div>
          )}
          {data.requests?.map((r: any) => (
            <div className="settings-field" key={r.id}>
              <div>
                <strong>{r.name} 请求连接</strong>
                <small>设备指纹 {r.fingerprint}</small>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void change({
                    action: "approve",
                    id: r.id,
                    allowApprovals: true,
                  })
                }
              >
                <ShieldCheck size={16} />
                确认连接
              </button>
            </div>
          ))}
          <h3>已连接手机</h3>
          {!data.devices?.filter((d: any) => !d.revokedAt).length && (
            <p className="muted">尚未连接手机</p>
          )}
          {data.devices
            ?.filter((d: any) => !d.revokedAt)
            .map((d: any) => (
              <div className="settings-field" key={d.id}>
                <div>
                  <strong>{d.name}</strong>
                  <small>{new Date(d.createdAt).toLocaleString()}</small>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void change({ action: "revoke", id: d.id })}
                >
                  撤销连接
                </button>
              </div>
            ))}
          <details>
            <summary>远程连接</summary>
            <p className="settings-description">
              配置加密中继后，离开同一 Wi-Fi
              仍能连接此电脑。中继地址和凭据由服务部署方提供。
            </p>
            <input
              aria-label="中继地址"
              placeholder="wss://relay.example.com"
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
            />
            <input
              aria-label="中继凭据"
              type="password"
              value={relayToken}
              onChange={(e) => setRelayToken(e.target.value)}
            />
            <button
              className="secondary"
              disabled={busy || !relayUrl || !relayToken}
              onClick={() =>
                void change({
                  action: "relay",
                  url: relayUrl,
                  token: relayToken,
                })
              }
            >
              保存中继
            </button>
            {data.relay?.configured && (
              <p className="muted">
                {data.relayStatus === "connected" ? "已连接" : "正在连接中继"}{" "}
                {data.relay.url}
              </p>
            )}
          </details>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void change({ action: "disable" })}
          >
            关闭手机连接
          </button>
        </>
      )}
    </section>
  );
}
