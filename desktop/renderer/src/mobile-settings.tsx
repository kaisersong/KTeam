import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Smartphone, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { api, explain } from "./api";
export function MobileSettings() {
  const [data, setData] = useState<any>(),
    [invite, setInvite] = useState<any>(),
    [qr, setQr] = useState(""),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false),
    [busy, setBusy] = useState(false),
    [relayUrl, setRelayUrl] = useState(""),
    [relayToken, setRelayToken] = useState(""),
    [typedFingerprint, setTypedFingerprint] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const preparing = useRef(false);
  const load = async () => {
    try {
      const v = await api.mobileSettings();
      setData(v);
    } catch (e) {
      setError(explain(e));
    }
  };
  useEffect(() => {
    void showCode();
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
    if (preparing.current) return;
    preparing.current = true;
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const current = await api.mobileSettings();
      setData(current);
      if (!current.enabled)
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
      preparing.current = false;
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
        打开手机 KTeam，点“扫码连接电脑”。未保存远程中继时，手机只连接这台电脑公布的局域网地址，不会改连其他中继。
      </p>
      {error && (
        <p role="alert" className="flow-error">
          {error}
        </p>
      )}
      {busy && !invite && (
        <p role="status" className="settings-description">
          正在准备二维码…
        </p>
      )}
      {((!invite && !busy) || expired) && (
        <button
          className="primary"
          disabled={busy}
          onClick={() => void showCode()}
        >
          <QrCode size={18} /> {expired ? "刷新二维码" : "重新生成二维码"}
        </button>
      )}
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
                  : `扫码后，在此确认手机连接。二维码还剩 ${Math.max(0, Math.ceil((expiresAt - now) / 1000))} 秒。`}
              </p>
              {!expired && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void showCode()}
                >
                  换一个二维码
                </button>
              )}
              {!expired && (
                <details>
                  <summary>无法扫码？</summary>
                  <button
                    className="secondary"
                    onClick={() => {
                      void api
                        .copyMobileInvitation({ link: invite.link })
                        .then(() => {
                          setCopied(true);
                          setError("");
                        })
                        .catch(() =>
                          setError("复制失败，请刷新二维码后重新扫码"),
                        );
                    }}
                  >
                    {copied ? "已复制配对链接" : "复制配对链接"}
                  </button>
                </details>
              )}
            </div>
          )}
          {data.requests?.map((r: any) => (
            <div className="settings-field" key={r.id}>
              <div>
                <strong>{r.name} 请求连接</strong>
                <small>输入这部手机屏幕上的 12 位指纹</small>
              </div>
              <input
                aria-label={"手机指纹 " + r.name}
                autoComplete="off"
                spellCheck={false}
                maxLength={12}
                value={typedFingerprint[r.id] ?? ""}
                placeholder="手机上的 12 位指纹"
                onChange={(e) =>
                  setTypedFingerprint((current) => ({
                    ...current,
                    [r.id]: e.target.value,
                  }))
                }
              />
              <button
                className="primary"
                disabled={busy || (typedFingerprint[r.id] ?? "").trim().length !== 12}
                onClick={() =>
                  void change({
                    action: "approve",
                    id: r.id,
                    fingerprint: (typedFingerprint[r.id] ?? "").trim().toLowerCase(),
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
              仍能连接此电脑。中继地址和凭据由服务部署方提供。中继失败时，手机仍会尝试局域网直接连接。
              {data.relay?.configured
                ? ` 当前远程中继是 ${data.relay.url}。`
                : " 当前没有配置远程中继。"}
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
