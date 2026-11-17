import React, {
  memo,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Alert,
  ActivityIndicator,
  AppState,
  BackHandler,
  Keyboard,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Network from "expo-network";
import Markdown from "react-native-markdown-display";
import { WebView } from "react-native-webview";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  ImagePlus,
  Monitor,
  Search,
  Sparkles,
  ChevronDown,
  Inbox,
  MessageCircle,
  Paperclip,
  Plus,
  QrCode,
  RefreshCw,
  Smartphone,
  X,
  Zap,
  ZapOff,
} from "lucide-react-native";
import { Buffer } from "buffer";
import { GlassSurface, GlassGroup } from "./src/glass";
import notices from "./third-party-notices.json";
import {
  MobileConnection,
  pairingComputer,
  parseInvitation,
  type Computer,
} from "./src/transport";
import {
  deviceIdentity,
  cachedMessages,
  cacheMessages,
  computers,
  saveComputer,
  selectComputer,
  forgetComputer,
  readCache,
  writeCache,
  savePending,
  pending,
  clearPending,
  clearReadCache,
} from "./src/storage";
import {
  attachmentMessageView,
  messageDisplayText,
  attachmentImageType,
} from "../src/protocol/message-attachments";
import {
  mentionQuery,
  rebaseMentions,
  selectedMentions,
  mentionAgentAddress,
  type MentionToken,
} from "../src/protocol/mentions";
import {
  mergeMessages,
  visibleRooms,
} from "../src/protocol/mobile-message-cache";
const uid = () => Crypto.randomUUID().replace(/-/g, "");
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const names: Record<string, string> = {
  model_authentication_failed:
    "模型凭据无效或无访问权限，请在电脑的模型设置中检查。",
  model_quota_exhausted: "模型额度不足或受到限流，请在电脑检查模型服务。",
  generated_file_not_found: "这份产物暂不可用，请确认连接的是生成它的电脑。",
  generated_file_receipt_changed: "产物记录已变化，请在电脑核对。",
  mobile_auth_required: "手机连接已失效，请重新配对",
  mobile_device_revoked: "手机权限已被撤销",
  mobile_operation_unknown: "结果待核对，请勿重复发送",
  mobile_approval_scope_forbidden: "请在电脑上修改长期授权",
  team_scope_changed: "会话权限已变化，请刷新",
  generated_file_changed: "文件已变化，请在电脑核对",
};
function safeHTML(content: string) {
  return (
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    content
  );
}
const MessageRow = memo(function MessageRow({
  message: m,
  work,
  bots,
  colors,
  call,
  onOpen: setPreview,
  onReply: setReply,
  onFile: viewFile,
}: any) {
  const job = work?.jobs?.find((j: any) =>
      j.results?.some((r: any) => r.messageId === m.messageId),
    ),
    receipts = (job?.generatedFiles ?? []).filter(
      (f: any) => f.botId === m.sender.logicalAgentId,
    );
  return (
    <View
      style={[
        s.message,
        {
          alignSelf: m.sender.kind === "user" ? "flex-end" : "flex-start",
          backgroundColor:
            m.sender.kind === "user" ? colors.user : colors.panel,
          borderColor: colors.line,
        },
      ]}
    >
      {m.sender.kind !== "user" && (
        <Text style={[s.caption, { color: colors.muted, marginBottom: 5 }]}>
          {m.sender.kind === "user"
            ? "我"
            : (bots.find((b: any) => b.id === m.sender.logicalAgentId)?.name ??
              "成员")}
        </Text>
      )}
      <Pressable
        onLongPress={() =>
          Alert.alert("消息", "", [
            {
              text: "复制",
              onPress: () =>
                void Clipboard.setStringAsync(messageDisplayText(m)),
            },
            { text: "回复", onPress: () => setReply(m) },
            { text: "取消" },
          ] as any)
        }
      >
        {/^[^\n`*_#\[\]<>]*$/.test(messageDisplayText(m)) &&
        !/https?:\/\//i.test(messageDisplayText(m)) ? (
          <Text
            selectable
            style={{ color: colors.text, fontSize: 15, lineHeight: 23 }}
          >
            {messageDisplayText(m)}
          </Text>
        ) : (
          <Markdown
            style={{
              body: {
                color: colors.text,
                fontSize: 15,
                lineHeight: 23,
              },
              link: { color: colors.green },
              code_inline: {
                backgroundColor: colors.user,
                color: colors.text,
              },
              fence: {
                backgroundColor: colors.user,
                color: colors.text,
              },
              table: { borderColor: colors.line },
            }}
            onLinkPress={(url) => {
              let filename = "";
              try {
                filename = decodeURIComponent(url).split("/").pop() ?? "";
              } catch {}
              const found = receipts.filter(
                (f: any) => (f.file?.name ?? f.name) === filename,
              );
              if (found.length === 1) void viewFile(found[0]);
              else if (/^https?:\/\//i.test(url)) void Linking.openURL(url);
              return false;
            }}
          >
            {messageDisplayText(m)}
          </Markdown>
        )}
      </Pressable>
      {attachmentMessageView(m)?.attachments.map((file) => (
        <Attachment
          key={file.fileId}
          message={m}
          file={file}
          call={call}
          onOpen={setPreview}
          colors={colors}
        />
      ))}
      {receipts.map((f: any) => (
        <Pressable
          key={f.id}
          onPress={() => void viewFile(f)}
          style={[
            s.artifactCard,
            {
              borderColor: colors.line,
              backgroundColor: colors.bg,
            },
          ]}
        >
          <FileText size={25} strokeWidth={1.6} color={colors.green} />
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={2}
              style={{
                color: colors.text,
                fontWeight: "500",
                fontSize: 14,
              }}
            >
              {f.file?.name ?? f.name}
            </Text>
            <Text style={[s.caption, { color: colors.muted, marginTop: 3 }]}>
              轻点在应用内查看
            </Text>
          </View>
          <ChevronRight size={15} color={colors.muted} />
        </Pressable>
      ))}
    </View>
  );
});
function AppBody() {
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === "dark",
    colors = useMemo(
      () => ({
        bg: dark ? "#111914" : "#f5f7f2",
        panel: dark ? "#202a23" : "#ffffff",
        text: dark ? "#edf3e9" : "#24372a",
        muted: dark ? "#9eae9b" : "#74816f",
        line: dark ? "#354235" : "#e1e8de",
        green: dark ? "#a8d3ae" : "#276747",
        user: dark ? "#314331" : "#e6efe2",
      }),
      [dark],
    );
  const [saved, setSaved] = useState<Computer[]>([]),
    [computer, setComputer] = useState<Computer>(),
    [tab, setTab] = useState("会话"),
    [rooms, setRooms] = useState<any[]>([]),
    [bots, setBots] = useState<any[]>([]),
    [room, setRoom] = useState<any>(),
    [messages, setMessages] = useState<any[]>([]),
    [work, setWork] = useState<any>(),
    [inbox, setInbox] = useState<any>(),
    [files, setFiles] = useState<any[]>([]),
    [text, setText] = useState(""),
    [draftReady, setDraftReady] = useState(false),
    [tokens, setTokens] = useState<MentionToken[]>([]),
    [queryText, setQueryText] = useState(""),
    [members, setMembers] = useState<any[]>([]),
    [skills, setSkills] = useState<any[]>([]),
    [error, setError] = useState(""),
    [status, setStatus] = useState("未连接"),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(false),
    [connecting, setConnecting] = useState(false),
    [connectionRevision, setConnectionRevision] = useState(0),
    [scan, setScan] = useState(false),
    [scanError, setScanError] = useState(""),
    [torch, setTorch] = useState(false),
    [pairingName, setPairingName] = useState("电脑"),
    [pairingPhase, setPairingPhase] = useState("connecting"),
    [manualPair, setManualPair] = useState(false),
    [attachmentMenu, setAttachmentMenu] = useState(false),
    [pairLink, setPairLink] = useState(""),
    [pairing, setPairing] = useState(false),
    [uploads, setUploads] = useState<any[]>([]),
    [uncertain, setUncertain] = useState<any[]>([]),
    [reply, setReply] = useState<any>(),
    [preview, setPreview] = useState<any>(),
    [latest, setLatest] = useState(true),
    [permission, requestPermission] = useCameraPermissions();
  const followLatest = useRef(true);
  const followAfterLayout = useRef(true);
  const returnView = useRef<any>(undefined);
  const previewRequest = useRef(0);
  const viewability = useRef({
    itemVisiblePercentThreshold: 100,
    minimumViewTime: 1000,
  }).current;
  const olderLoading = useRef(false);
  const olderComplete = useRef(new Set<string>());
  const connection = useRef<MobileConnection | undefined>(undefined),
    generation = useRef(0),
    roomRef = useRef<any>(undefined),
    messagesRef = useRef<any[]>([]),
    cursor = useRef<string | undefined>(undefined),
    active = useRef(AppState.currentState === "active"),
    refreshing = useRef<MobileConnection | undefined>(undefined),
    resumeConnection = useRef<() => void>(() => {}),
    networkSignature = useRef<string | undefined>(undefined),
    networkAvailable = useRef<boolean | undefined>(undefined),
    connectingSince = useRef(0),
    list = useRef<FlatList>(null),
    pairGeneration = useRef(0),
    pairingActive = useRef(false),
    pairingConnection = useRef<MobileConnection | undefined>(undefined),
    scanConsumed = useRef(false),
    pairingCandidate = useRef<Computer | undefined>(undefined),
    pairAction = useRef<(link: string) => void>(() => {});
  const openConnections = () => {
    setRoom(undefined);
    setTab("我");
    setError("");
  };
  const reconnect = () => {
    if (networkAvailable.current === false) {
      connection.current?.close();
      setConnecting(false);
      setOffline(true);
      setStatus("手机当前未联网");
      setError("手机当前未联网，网络恢复后会自动连接");
      return;
    }
    setError("");
    setOffline(true);
    setConnecting(true);
    setStatus("正在重新连接…");
    setConnectionRevision((v) => v + 1);
  };
  resumeConnection.current = reconnect;
  const cancelPair = () => {
    pairGeneration.current++;
    pairingConnection.current?.close();
    pairingConnection.current = undefined;
    pairingActive.current = false;
    setPairing(false);
  };
  roomRef.current = room;
  messagesRef.current = messages;
  const call = useCallback(
    async (method: string, input: any = {}) => {
      const transport = connection.current;
      if (!transport) throw Error("请先连接电脑");
      if (transport.computer.credentialId !== computer?.credentialId)
        throw Error("电脑已切换，请重试");
      let result: any;
      try {
        result = await transport.call(method, input);
      } catch (e) {
        if (
          connection.current === transport &&
          [
            "mobile_auth_required",
            "mobile_device_revoked",
            "team_scope_changed",
            "skill_room_denied",
          ].includes(errorText(e))
        ) {
          setMessages([]);
          setWork(undefined);
          setPreview(undefined);
          setInbox(undefined);
          setFiles([]);
          setRooms([]);
          setRoom(undefined);
          setMembers([]);
          await clearReadCache(transport.computer).catch(() => {});
          if (
            ["mobile_auth_required", "mobile_device_revoked"].includes(
              errorText(e),
            )
          ) {
            transport.close();
            setComputer(undefined);
            setTab("我");
            setStatus("连接已失效，请重新配对");
          }
        }
        throw e;
      }
      if (connection.current !== transport) throw Error("电脑已切换，请刷新");
      return result;
    },
    [computer?.credentialId],
  );
  const tell = (e: unknown) => setError(names[errorText(e)] ?? errorText(e));
  const persist = async (c: Computer, k: string, v: any) => {
    try {
      await writeCache(c, k, v);
    } catch {}
  };
  const getPending = async (c: Computer) => {
    try {
      const rows = await pending(c);
      if (connection.current?.computer.credentialId === c.credentialId)
        setUncertain(rows);
    } catch {}
  };
  const refresh = useCallback(async () => {
    const transport = connection.current;
    if (!transport || networkAvailable.current === false || refreshing.current === transport || !computer || !active.current) return;
    refreshing.current = transport;
    const g = generation.current,
      r = roomRef.current;
    try {
      await transport.connect();
      if (g !== generation.current || connection.current !== transport) return;
      setConnecting(false);
      setOffline(false);
      setStatus(transport.route);
      if (!r) {
        const [a, b, c] = await Promise.all([
          call("rooms.list"),
          call("bots.list"),
          call("inbox.read"),
        ]);
        if (g !== generation.current) return;
        setRooms((old) =>
          JSON.stringify(old) === JSON.stringify(a.rooms) ? old : a.rooms,
        );
        setBots((old) =>
          JSON.stringify(old) === JSON.stringify(b.bots) ? old : b.bots,
        );
        setInbox(c);
        await persist(computer, "rooms", a.rooms);
        await persist(computer, "bots", b.bots);
      } else {
        const v = await call("conversations.updates", {
          roomId: r.roomId,
          ...(cursor.current ? { cursor: cursor.current } : {}),
          messageIds: messagesRef.current.slice(-250).map((m) => m.messageId),
        });
        if (g !== generation.current || roomRef.current?.roomId !== r.roomId)
          return;
        cursor.current = v.cursor;
        const incoming = v.messages?.messages ?? [];
        const all = mergeMessages(messagesRef.current, incoming);
        if (all !== messagesRef.current) {
          followAfterLayout.current = followLatest.current;
          messagesRef.current = all;
          setMessages(all);
        }
        if (v.work)
          setWork((old: any) =>
            JSON.stringify(old) === JSON.stringify(v.work) ? old : v.work,
          );
        if (v.settings?.members)
          setMembers(
            v.settings.members
              .filter(
                (m: any) =>
                  m.status === "active" && m.subject?.kind === "agent",
              )
              .map((m: any) => ({
                address: mentionAgentAddress(m.subject.logicalAgentId),
                name:
                  bots.find((b: any) => b.id === m.subject.logicalAgentId)
                    ?.name ?? "成员",
                botId: m.subject.logicalAgentId,
              })),
          );
        void cacheMessages(computer, r.roomId, incoming).catch(() => {});
      }
      if (g === generation.current) {
        setConnecting(false);
        setOffline(false);
        setStatus(connection.current?.route ?? "已连接");
        setError("");
        await getPending(computer);
      }
    } catch (e) {
      if (g === generation.current) {
        const terminal = ["mobile_auth_required", "mobile_device_revoked", "mobile_host_key_changed"].includes(errorText(e));
        if (!transport.isReady && !terminal && Date.now() - connectingSince.current < 15000) {
          setConnecting(true);
          setOffline(true);
          setStatus("正在连接电脑…");
          setError("");
          return;
        }
        setConnecting(false);
        setOffline(!transport.isReady);
        setStatus(transport.isReady ? transport.route :
          ["mobile_auth_required", "mobile_device_revoked"].includes(
            errorText(e),
          )
            ? "连接已失效，请重新配对"
            : "离线 · 显示已同步内容",
        );
        tell(e);
      }
    } finally {
      if (refreshing.current === transport) refreshing.current = undefined;
    }
  }, [computer, call, bots]);
  useEffect(() => {
    void computers().then((v) => {
      setSaved(v);
      if (v[0]) setComputer(v[0]);
    });
    const sub = AppState.addEventListener("change", (s) => {
      const wasActive = active.current;
      active.current = s === "active";
      if (!wasActive && active.current && connection.current) resumeConnection.current();
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const changed = connection.current?.computer.credentialId !== computer?.credentialId;
    generation.current++;
    connection.current?.close();
    cursor.current = undefined;
    if (changed) {
    setMessages([]);
    setRooms([]);
    setBots([]);
    setInbox(undefined);
    setFiles([]);
    setUncertain([]);
    setRoom(undefined);
    setWork(undefined);
    setUploads([]);
    }
    setError("");
    connectingSince.current = Date.now();
    setConnecting(!!computer);
    if (!computer) {
      connection.current = undefined;
      return;
    }
    const c = computer,
      transport = new MobileConnection(c, (updated) => {
        void saveComputer(updated).catch(() => {});
      });
    connection.current = transport;
    setOffline(true);
    setStatus("连接中…");
    void Promise.all([readCache(c, "rooms"), readCache(c, "bots")])
      .then(([r, b]) => {
        if (connection.current !== transport) return;
        if (r) setRooms(r);
        if (b) setBots(b);
      })
      .catch(() => {});
    void refresh();
    const network = Network.addNetworkStateListener((state) => {
      if (connection.current !== transport || typeof state.isConnected !== "boolean" || state.type === Network.NetworkStateType.UNKNOWN) return;
      // Reachability probes can fluctuate without a link change; they must not
      // repeatedly cancel an authenticated socket.
      const signature = [state.type, state.isConnected].join(":");
      const previous = networkSignature.current;
      networkSignature.current = signature;
      networkAvailable.current = state.isConnected;
      if (!state.isConnected) {
        generation.current++;
        transport.close();
        setOffline(true);
        setConnecting(false);
        setStatus("手机当前未联网");
        setError("手机当前未联网，网络恢复后会自动连接");
        return;
      }
      if (!active.current) return;
      if (previous && previous !== signature) resumeConnection.current();
      else void refresh();
    });
    return () => {
      network.remove();
      transport.close();
    };
  }, [computer?.credentialId, computer?.secret, connectionRevision]);
  useEffect(() => {
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    if (!computer) return;
    cursor.current = undefined;
    setDraftReady(false);
    followLatest.current = true;
    followAfterLayout.current = true;
    setLatest(true);
    generation.current++;
    messagesRef.current = [];
    setMessages([]);
    setWork(undefined);
    setReply(undefined);
    setText("");
    setTokens([]);
    setUploads([]);
    const r = room,
      g = generation.current;
    setMembers([]);
    setSkills([]);
    if (r)
      void cachedMessages(computer, r.roomId)
        .then((v) => {
          if (
            g === generation.current &&
            roomRef.current?.roomId === r.roomId &&
            v
          )
            setMessages((old) => {
              const next = mergeMessages(v, old);
              messagesRef.current = next;
              return next;
            });
        })
        .catch(() => {});
    if (r)
      void readCache(computer, "draft:" + r.roomId)
        .then((v) => {
          if (g !== generation.current || roomRef.current?.roomId !== r.roomId)
            return;
          setText(v?.text ?? "");
          setTokens(v?.tokens ?? []);
          setUploads(v?.uploads ?? []);
          if (v?.replyToMessageId)
            setReply({ messageId: v.replyToMessageId, text: "已引用消息" });
          setDraftReady(true);
        })
        .catch(() => {
          if (g === generation.current) setDraftReady(true);
        });
    void refresh();
  }, [room?.roomId]);
  useEffect(() => {
    if (!computer || !room || !draftReady) return;
    const c = computer,
      r = room;
    const id = setTimeout(() => {
      void writeCache(c, "draft:" + r.roomId, {
        text,
        tokens,
        uploads,
        replyToMessageId: reply?.messageId,
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [
    computer?.credentialId,
    room?.roomId,
    draftReady,
    text,
    tokens,
    uploads,
    reply?.messageId,
  ]);
  useEffect(() => {
    const handler = ({ url }: { url: string }) => {
      if (url.startsWith("kteam://pair")) {
        setRoom(undefined);
        pairAction.current(url);
      }
    };
    const sub = Linking.addEventListener("url", handler);
    void Linking.getInitialURL().then((url) => {
      if (url) handler({ url });
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    let current = true;
    setSkills([]);
    if (
      !room ||
      !["direct", "assistant"].includes(room.kind) ||
      members.length !== 1
    )
      return;
    void call("skills.list", { roomId: room.roomId, botId: members[0].botId })
      .then((v) => {
        if (current)
          setSkills(
            (v.skills ?? []).filter(
              (s: any) => s.enabled && !s.sourceError && !s.versionChanged,
            ),
          );
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [room?.roomId, members.map((m) => m.botId).join(",")]);
  useEffect(() => {
    const listener = Keyboard.addListener("keyboardDidHide", () => {
      if (followAfterLayout.current) {
        list.current?.scrollToOffset({ offset: 0, animated: false });
      }
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (room) {
        setRoom(undefined);
        return true;
      }
      if (tab !== "会话") {
        cancelPair();
        setTab("会话");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [room, tab]);
  const pair = async (link: string) => {
    if (pairingActive.current) return;
    pairingActive.current = true;
    setRoom(undefined);
    setTab("我");
    setManualPair(false);
    setPairingPhase("connecting");
    const attempt = ++pairGeneration.current;
    setPairing(true);
    setScan(false);
    setError("");
    let transport: MobileConnection | undefined;
    try {
      const invite = parseInvitation(link);
      const previous = pairingCandidate.current;
      const candidate =
        previous?.credentialId === invite.inviteId &&
        previous.publicKey === invite.publicKey &&
        previous.secret === invite.secret
          ? previous
          : pairingComputer(invite, await deviceIdentity());
      if (attempt !== pairGeneration.current) return;
      pairingCandidate.current = candidate;
      setPairingName(invite.computerName);
      transport = new MobileConnection(candidate);
      pairingConnection.current = transport;
      await transport.connect();
      setPairingPhase("confirming");
      setStatus("请在电脑确认这部手机");
      while (
        attempt === pairGeneration.current &&
        Date.now() < invite.expiresAt
      ) {
        const v = await transport.call("pair", {
          name: Platform.OS === "ios" ? "我的 iPhone" : "我的 Android",
        });
        if (attempt !== pairGeneration.current) return;
        if (v.paired) {
          const c = {
            ...candidate,
            credentialId: v.deviceId,
            secret: v.secret,
          };
          await saveComputer(c);
          if (attempt !== pairGeneration.current) return;
          pairingCandidate.current = undefined;
          await transport.call("pair", { action: "finish" }).catch(() => {});
          setSaved(await computers());
          setComputer(c);
          setPairLink("");
          setTab("会话");
          return;
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
      throw Error("配对已取消或二维码已过期");
    } catch (e) {
      if (attempt === pairGeneration.current) tell(e);
    } finally {
      transport?.close();
      if (pairingConnection.current === transport)
        pairingConnection.current = undefined;
      if (attempt === pairGeneration.current) {
        pairingActive.current = false;
        setPairing(false);
      }
    }
  };
  pairAction.current = (link) => {
    void pair(link);
  };
  const openRoom = (r: any) => {
    setRoom(r);
    setTab("会话");
  };
  const loadOlder = async () => {
    const r = roomRef.current,
      c = computer;
    if (
      olderLoading.current ||
      !r ||
      !c ||
      !messagesRef.current.length ||
      olderComplete.current.has(c.credentialId + ":" + r.roomId)
    )
      return;
    olderLoading.current = true;
    const g = generation.current,
      before = messagesRef.current[0].roomSequence;
    try {
      const local = await cachedMessages(c, r.roomId, before);
      const rows = local.length
        ? local
        : (
            await call("messages.page", {
              roomId: r.roomId,
              before,
              tail: true,
            })
          ).messages;
      if (!local.length) await cacheMessages(c, r.roomId, rows);
      if (g !== generation.current || roomRef.current?.roomId !== r.roomId)
        return;
      if (!rows.length)
        olderComplete.current.add(c.credentialId + ":" + r.roomId);
      const next = mergeMessages(messagesRef.current, rows);
      messagesRef.current = next;
      setMessages(next);
    } catch (e) {
      tell(e);
    } finally {
      olderLoading.current = false;
    }
  };
  const viewFile = useCallback(
    async (file: any) => {
      const request = ++previewRequest.current;
      const name = file.name ?? file.file?.name ?? "产物";
      setPreview({ name, loading: true });
      try {
        const v = await call("artifacts.preview", {
          roomId: file.roomId ?? roomRef.current?.roomId,
          toolCallId: file.toolCallId ?? file.id,
        });
        if (request === previewRequest.current)
          setPreview({ ...v, name: v.name ?? name });
      } catch (e) {
        if (request === previewRequest.current)
          setPreview({
            name,
            error: names[errorText(e)] ?? errorText(e),
            retry: file,
          });
      }
    },
    [call],
  );
  const closePreview = () => {
    previewRequest.current++;
    setPreview(undefined);
  };
  const checkSend = async (item: any) => {
    setBusy(true);
    try {
      const v = await call("operations.get", { operationId: item.operationId });
      if (v.status === "completed") {
        await clearPending(computer!, item.operationId);
        setText("");
        setUploads([]);
        await getPending(computer!);
        await refresh();
      } else if (v.status === "not_received") {
        Alert.alert("电脑尚未收到", "沿用同一编号重新发送？", [
          { text: "取消" },
          { text: "重新发送", onPress: () => void retrySend(item) },
        ]);
      } else if (v.status === "rejected") {
        setError(names[v.code] ?? v.code);
        await clearPending(computer!, item.operationId);
        await getPending(computer!);
      } else setError("原操作结果仍待核对，请先在电脑查看，不会自动重复执行。");
    } catch (e) {
      tell(e);
    } finally {
      setBusy(false);
    }
  };
  const retrySend = async (item: any) => {
    setBusy(true);
    try {
      await call(item.method, { ...item.input, operationId: item.operationId });
      await clearPending(computer!, item.operationId);
      await getPending(computer!);
      await refresh();
    } catch (e) {
      tell(e);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!room || !computer || (!text.trim() && !uploads.length)) return;
    setBusy(true);
    const operationId = uid(),
      id = "msg_" + uid(),
      mentions = selectedMentions(text, tokens, members),
      method = uploads.length ? "attachments.send" : "messages.send",
      input: any = {
        roomId: room.roomId,
        id,
        text,
        mentions,
        ...(reply ? { replyToMessageId: reply.messageId } : {}),
      };
    if (uploads.length) input.uploadIds = uploads.map((v) => v.id);
    else input.createdAt = new Date().toISOString();
    const item = { operationId, method, input };
    try {
      await savePending(computer, operationId, item);
      await call(method, { ...input, operationId });
      await clearPending(computer, operationId);
      setText("");
      setTokens([]);
      setUploads([]);
      setReply(undefined);
      await getPending(computer);
      await refresh();
      followLatest.current = true;
      followAfterLayout.current = true;
      setLatest(true);
      list.current?.scrollToOffset({ offset: 0 });
    } catch (e) {
      tell(e);
      await getPending(computer);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (uri: string, name: string) => {
    setBusy(true);
    try {
      const file = new File(uri);
      if (file.size > 4 * 1024 * 1024) throw Error("单个文件最多 4 MB");
      const data = Buffer.from(await file.arrayBuffer()).toString("base64"),
        id = "upload_" + uid();
      await call("attachments.stage", {
        operationId: uid(),
        roomId: room.roomId,
        id,
        name,
        data,
      });
      setUploads((v) => [...v, { id, name }]);
    } catch (e) {
      tell(e);
    } finally {
      setBusy(false);
    }
  };
  const chooseImage = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
      });
      if (!r.canceled)
        await upload(r.assets[0].uri, r.assets[0].fileName ?? "image.jpg");
    } catch (e) {
      tell(e);
    }
  };
  const chooseFile = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
      });
      if (!r.canceled) await upload(r.assets[0].uri, r.assets[0].name);
    } catch (e) {
      tell(e);
    }
  };
  const paste = async () => {
    try {
      if (await Clipboard.hasImageAsync()) {
        const image = await Clipboard.getImageAsync({ format: "png" });
        if (image) {
          const id = "upload_" + uid();
          await call("attachments.stage", {
            operationId: uid(),
            roomId: room.roomId,
            id,
            name: "image.png",
            data: image.data.replace(/^data:[^;]+;base64,/, ""),
          });
          setUploads((v) => [...v, { id, name: "image.png" }]);
          return;
        }
      }
      const pasted = await Clipboard.getStringAsync();
      setText((t) => t + pasted);
    } catch (e) {
      tell(e);
    }
  };
  const requestFiles = async () => {
    setTab("产物");
    setFiles([]);
    try {
      const selected = room ? [room] : rooms;
      const all = await Promise.all(
        selected.map(async (r) => ({
          room: r,
          ...(await call("artifacts.list", { roomId: r.roomId })),
        })),
      );
      setFiles(
        all.flatMap((v) =>
          v.items.map((f: any) => ({
            ...f,
            roomId: v.room.roomId,
            roomTitle: v.room.title,
          })),
        ),
      );
    } catch (e) {
      tell(e);
    }
  };
  const decide = async (a: any, decision: string) => {
    setBusy(true);
    try {
      await call("approvals.decide", {
        operationId: uid(),
        id: a.id,
        expectedHash: a.hash,
        decision,
      });
      const next = await call("inbox.read");
      setInbox(next);
    } catch (e) {
      tell(e);
    } finally {
      setBusy(false);
    }
  };
  const markSeen = useRef(({ viewableItems }: any) => {
    if (!active.current || !roomRef.current || !connection.current) return;
    const sequences = viewableItems
      .map((v: any) => v.item.roomSequence)
      .filter(Number.isSafeInteger);
    if (sequences.length)
      void connection.current
        .call("messages.seen", {
          operationId: uid(),
          roomId: roomRef.current.roomId,
          sequences,
        })
        .catch(() => {});
  }).current;
  const button = (
    label: string,
    onPress: () => void,
    icon?: React.ReactNode,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={label === "图片" ? "长按可粘贴剪贴板图片" : undefined}
      onLongPress={label === "图片" ? () => void paste() : undefined}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        s.button,
        { borderColor: colors.line, opacity: disabled ? 0.45 : 1 },
      ]}
    >
      {icon}
      <Text style={{ color: colors.text, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
  const assistantRoom = rooms.find((r) => r.kind === "assistant"),
    needsYou =
      (inbox?.approvals?.length ?? 0) + (inbox?.questions?.length ?? 0);
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);
  const filtered = visibleRooms(rooms).filter((r) =>
      (r.title ?? "").toLowerCase().includes(queryText.toLowerCase()),
    ),
    query = mentionQuery(text, text.length),
    choices = query
      ? members.filter((m) =>
          m.name.toLowerCase().includes(query.query.toLowerCase()),
        )
      : [];
  const selectMention = (m: any) => {
    if (!query) return;
    const before = text.slice(0, query.start),
      next = before + "@" + m.name + " " + text.slice(query.end);
    setTokens([
      ...rebaseMentions(text, next, tokens),
      { ...m, start: query.start, end: query.start + 1 + m.name.length },
    ]);
    setText(next);
  };
  const startScan = async () => {
    if (pairing) return;
    setError("");
    setScanError("");
    setTorch(false);
    scanConsumed.current = false;
    if (permission?.granted || (await requestPermission()).granted)
      setScan(true);
    else
      Alert.alert(
        "需要相机权限",
        "允许访问相机后即可扫码，也可以粘贴电脑端的配对链接。",
        [
          {
            text: "粘贴链接",
            onPress: () => {
              setManualPair(true);
              setTab("我");
            },
          },
          { text: "打开设置", onPress: () => void Linking.openSettings() },
          { text: "取消", style: "cancel" },
        ],
      );
  };
  const pendingRoom = uncertain.filter((v) => v.input?.roomId === room?.roomId);
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <StatusBar style={dark ? "light" : "dark"} />
      <View
        pointerEvents="none"
        style={[s.ambient, { backgroundColor: dark ? "#284338" : "#dceada" }]}
      />
      <GlassGroup style={s.header}>
        {room ? (
          <GlassSurface interactive style={s.circleControl}>
            <Pressable
              accessibilityLabel="返回会话"
              onPress={() => setRoom(undefined)}
              style={s.iconControl}
            >
              <ArrowLeft color={colors.text} size={21} />
            </Pressable>
          </GlassSurface>
        ) : (
          <Text style={[s.brand, { color: colors.text }]}>
            KTeam<Text style={{ color: colors.green }}>·</Text>
          </Text>
        )}
        {room ? (
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[s.title, { color: colors.text }]}>
              {room.title}
            </Text>
            <Text style={[s.caption, { color: colors.muted }]}>{status}</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <GlassSurface interactive style={s.computerPill}>
          <Pressable
            accessibilityLabel="电脑与连接"
            onPress={() => {
              if (tab === "我") {
                const back = returnView.current;
                setTab(back?.tab ?? "会话");
                setRoom(back?.room);
              } else {
                returnView.current = { tab, room };
                setRoom(undefined);
                setTab("我");
              }
            }}
            style={s.computerButton}
          >
            <Monitor size={16} color={colors.green} />
            <Text
              numberOfLines={1}
              style={{ color: colors.text, fontSize: 12, maxWidth: 140 }}
            >
              {computer?.computerName ?? "连接电脑"}
            </Text>
            <ChevronDown size={13} color={colors.muted} />
          </Pressable>
        </GlassSurface>
      </GlassGroup>
      {(error || (computer && offline)) && !connecting && !pairing && (
        <View
          style={[
            s.card,
            {
              backgroundColor: colors.panel,
              borderColor: colors.line,
              marginHorizontal: 16,
              marginVertical: 8,
            },
          ]}
        >
          <Text style={[s.title, { color: colors.text }]}>
            {computer && offline ? "暂时连接不上电脑" : "连接提示"}
          </Text>
          <Text style={[s.caption, { color: colors.muted, marginTop: 8 }]}>
            {error || "正在尝试连接电脑。"}
          </Text>
          <Text style={[s.caption, { color: colors.muted, marginTop: 8 }]}>
            确认电脑已联网并开启 KTeam。Wi-Fi 或 5G 均可连接；电脑恢复在线后会自动重连。
          </Text>
          <View style={s.actions}>
            {computer &&
              button(
                "重新连接",
                reconnect,
                <RefreshCw size={16} color={colors.green} />,
              )}
            {button(
              "重新扫码",
              () => void startScan(),
              <QrCode size={16} color={colors.green} />,
            )}
            {tab !== "我" && button("切换电脑", openConnections)}
          </View>
        </View>
      )}
      {tab === "会话" && !room && (
        <View style={{ flex: 1 }}>
          {computer && (
            <View style={s.homeHeading}>
              <Text style={[s.homeTitle, { color: colors.text }]}>
                今天，想推进什么？
              </Text>
              <Text style={[s.caption, { color: colors.muted, marginTop: 10 }]}>
                {connecting ? "正在连接电脑…" : offline ? "电脑暂时离线 · 可查看已同步内容" : status}
              </Text>
              <View style={[s.searchBar, { backgroundColor: colors.panel }]}>
                <Search size={18} color={colors.muted} />
                <TextInput
                  accessibilityLabel="搜索会话"
                  placeholder="搜索团队与对话"
                  placeholderTextColor={colors.muted}
                  value={queryText}
                  onChangeText={setQueryText}
                  style={{
                    flex: 1,
                    color: colors.text,
                    fontSize: 15,
                    paddingVertical: 10,
                  }}
                />
              </View>
            </View>
          )}
          {!computer ? (
            <ScrollView contentContainerStyle={s.welcome}>
              <Text style={[s.eyebrow, { color: colors.green }]}>
                让工作，自在流动
              </Text>
              <Text style={[s.welcomeTitle, { color: colors.text }]}>
                你的 AI 团队， 不止在电脑上。
              </Text>
              <Text style={[s.welcomeCopy, { color: colors.muted }]}>
                继续一段对话，确认一个决定， 或看看团队刚完成的作品。
              </Text>
              <View
                style={s.pairIllustration}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <View
                  style={[
                    s.computerSketch,
                    { backgroundColor: colors.panel, borderColor: colors.line },
                  ]}
                >
                  <View style={s.sketchDots}>
                    <View
                      style={[s.sketchDot, { backgroundColor: colors.line }]}
                    />
                    <View
                      style={[s.sketchDot, { backgroundColor: colors.line }]}
                    />
                    <View
                      style={[s.sketchDot, { backgroundColor: colors.line }]}
                    />
                  </View>
                  <Sparkles size={34} strokeWidth={1.1} color={colors.green} />
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 17,
                      fontWeight: "600",
                      marginTop: 14,
                    }}
                  >
                    KTeam
                  </Text>
                  <View
                    style={[s.sketchLine, { backgroundColor: colors.user }]}
                  />
                  <View
                    style={[
                      s.sketchLine,
                      { backgroundColor: colors.line, width: 70 },
                    ]}
                  />
                </View>
                <GlassSurface style={s.phoneSketch}>
                  <Smartphone
                    size={38}
                    strokeWidth={1.2}
                    color={colors.green}
                  />
                  <Text
                    style={{ color: colors.text, fontSize: 12, marginTop: 10 }}
                  >
                    随身同行
                  </Text>
                </GlassSurface>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="扫码连接电脑"
                disabled={pairing}
                onPress={() => void startScan()}
                style={[s.primaryAction, { backgroundColor: colors.green }]}
              >
                <QrCode size={21} color={colors.bg} />
                <Text
                  style={{ color: colors.bg, fontSize: 17, fontWeight: "600" }}
                >
                  {pairing ? "等待电脑确认…" : "扫码连接电脑"}
                </Text>
                <ArrowUp
                  size={19}
                  color={colors.bg}
                  style={{ transform: [{ rotate: "45deg" }] }}
                />
              </Pressable>
              <Text
                style={[
                  s.caption,
                  { color: colors.muted, textAlign: "center", marginTop: 16 },
                ]}
              >
                电脑侧栏点“连接手机”，用手机扫码。首次连接使用同一
                Wi-Fi，电脑保持唤醒
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setManualPair(true);
                  setTab("我");
                }}
                style={{ padding: 18, alignItems: "center" }}
              >
                <Text style={{ color: colors.green, fontSize: 14 }}>
                  粘贴配对链接
                </Text>
              </Pressable>
            </ScrollView>
          ) : (
            <FlatList
              contentContainerStyle={{
                paddingHorizontal: 18,
                paddingBottom: 110,
              }}
              ListHeaderComponent={
                <>
                  {assistantRoom && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="与小K助理对话"
                      onPress={() => openRoom(assistantRoom)}
                      style={[
                        s.assistantCard,
                        { backgroundColor: colors.user },
                      ]}
                    >
                      <View
                        style={[
                          s.assistantMark,
                          { backgroundColor: colors.panel },
                        ]}
                      >
                        <Sparkles
                          size={26}
                          strokeWidth={1.3}
                          color={colors.green}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color: colors.text,
                            fontSize: 19,
                            fontWeight: "600",
                          }}
                        >
                          交给小K
                        </Text>
                        <Text
                          style={[
                            s.caption,
                            { color: colors.muted, marginTop: 5 },
                          ]}
                        >
                          说说你的想法，让团队接着做。
                        </Text>
                      </View>
                      <ArrowUp
                        size={21}
                        color={colors.green}
                        style={{ transform: [{ rotate: "45deg" }] }}
                      />
                    </Pressable>
                  )}
                  {needsYou > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setTab("收件箱")}
                      style={[s.attentionCard, { borderColor: colors.line }]}
                    >
                      <Inbox size={18} color={colors.green} />
                      <Text style={{ color: colors.text, flex: 1 }}>
                        有 {needsYou} 件事需要你决定
                      </Text>
                      <ChevronRight size={16} color={colors.muted} />
                    </Pressable>
                  )}
                  <Text
                    style={[
                      s.eyebrow,
                      { color: colors.muted, marginTop: 16, marginBottom: 14 },
                    ]}
                  >
                    继续对话
                  </Text>
                </>
              }
              data={filtered}
              keyExtractor={(r) => r.roomId}
              refreshControl={
                <RefreshControl
                  refreshing={busy}
                  onRefresh={() => void refresh()}
                  tintColor={colors.green}
                />
              }
              renderItem={({ item: r }) => (
                <Pressable
                  onPress={() => openRoom(r)}
                  style={[s.roomCard, { backgroundColor: colors.panel }]}
                >
                  <View style={[s.avatar, { backgroundColor: colors.user }]}>
                    <MessageCircle
                      size={22}
                      strokeWidth={1.6}
                      color={colors.green}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.title, { color: colors.text }]}>
                      {r.title}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[s.caption, { color: colors.muted }]}
                    >
                      {r.lastMessage?.text ?? "开始对话"}
                    </Text>
                  </View>
                  {r.unread && (
                    <View style={[s.dot, { backgroundColor: colors.green }]} />
                  )}
                  <ChevronRight size={17} color={colors.muted} />
                </Pressable>
              )}
            />
          )}
        </View>
      )}
      {tab === "会话" && room && (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={{ flex: 1 }}>
            <FlatList
              ref={list}
              data={reversedMessages}
              initialNumToRender={12}
              maxToRenderPerBatch={6}
              windowSize={7}
              scrollEventThrottle={100}
              inverted
              keyExtractor={(m) => m.messageId}
              onEndReached={() => void loadOlder()}
              onEndReachedThreshold={0.3}
              ListFooterComponent={button(
                "加载更早消息",
                () => void loadOlder(),
              )}
              onScroll={(e) => {
                const { contentOffset, contentSize, layoutMeasurement } =
                  e.nativeEvent;
                followLatest.current = contentOffset.y < 100;
                setLatest(followLatest.current);
                if (
                  contentSize.height -
                    layoutMeasurement.height -
                    contentOffset.y <
                  500
                )
                  void loadOlder();
              }}
              onContentSizeChange={() => {
                if (followAfterLayout.current) {
                  followAfterLayout.current = false;
                  list.current?.scrollToOffset({ offset: 0, animated: false });
                }
              }}
              onViewableItemsChanged={markSeen}
              viewabilityConfig={viewability}
              maintainVisibleContentPosition={{
                minIndexForVisible: 0,
                autoscrollToTopThreshold: 100,
              }}
              contentContainerStyle={{ padding: 16 }}
              renderItem={({ item: m }) => (
                <MessageRow
                  message={m}
                  work={work}
                  bots={bots}
                  colors={colors}
                  call={call}
                  onOpen={setPreview}
                  onReply={setReply}
                  onFile={viewFile}
                />
              )}
            />
            {!latest && (
              <Pressable
                accessibilityLabel="到最新消息"
                onPress={() => {
                  followLatest.current = true;
                  setLatest(true);
                  list.current?.scrollToOffset({ offset: 0 });
                }}
                style={[
                  s.latest,
                  { backgroundColor: colors.panel, borderColor: colors.line },
                ]}
              >
                <ArrowDown size={22} color={colors.text} />
              </Pressable>
            )}
          </View>
          {work?.jobs?.[0] &&
            ["blocked", "unknown", "stopped"].includes(work.jobs[0].state) && (
              <View
                style={[
                  s.card,
                  {
                    backgroundColor: colors.panel,
                    borderColor: colors.line,
                    marginHorizontal: 16,
                  },
                ]}
              >
                <Text style={{ color: colors.text }}>本次工作未完成</Text>
                <Text
                  style={[s.caption, { color: colors.muted, marginTop: 6 }]}
                >
                  {names[work.jobs[0].reason] ??
                    "电脑上的执行已停止或结果待核对，请在电脑查看工作记录。"}
                </Text>
              </View>
            )}
          {work?.jobs
            ?.filter((j: any) => ["running", "routing"].includes(j.state))
            .map((j: any) => (
              <Text
                key={j.id}
                style={[
                  s.caption,
                  {
                    color: colors.muted,
                    paddingHorizontal: 18,
                    paddingBottom: 8,
                  },
                ]}
              >
                {bots.find((b: any) => b.id === j.activeBotId)?.name ?? "成员"}{" "}
                正在处理…
              </Text>
            ))}
          {work?.jobs?.some((j: any) =>
            ["running", "routing", "waiting"].includes(j.state),
          ) &&
            button(
              "停止当前工作",
              () => {
                void call("work.stop", {
                  operationId: uid(),
                  roomId: room.roomId,
                })
                  .then(() => refresh())
                  .catch(tell);
              },
              undefined,
              offline,
            )}
          {pendingRoom.map((p) => (
            <View
              key={p.operationId}
              style={[s.pending, { backgroundColor: colors.user }]}
            >
              <Text style={{ color: colors.text, flex: 1 }}>
                这条消息发送结果待核对
              </Text>
              {button("核对", () => void checkSend(p))}
            </View>
          ))}
          {reply && (
            <View style={s.pending}>
              <Text numberOfLines={1} style={{ flex: 1, color: colors.muted }}>
                回复：{messageDisplayText(reply)}
              </Text>
              {button(
                "取消引用",
                () => setReply(undefined),
                <X size={15} color={colors.muted} />,
              )}
            </View>
          )}
          {uploads.map((u) => (
            <View key={u.id} style={s.pending}>
              <FileText size={16} color={colors.green} />
              <Text style={{ color: colors.text, flex: 1 }}>{u.name}</Text>
              {button("移除", () => {
                void call("attachments.cancel", {
                  operationId: uid(),
                  roomId: room.roomId,
                  id: u.id,
                })
                  .then(() => setUploads((v) => v.filter((a) => a.id !== u.id)))
                  .catch(tell);
              })}
            </View>
          ))}
          {text.startsWith("/") && !text.includes(" ") && skills.length > 0 && (
            <View
              style={[
                s.mentions,
                { backgroundColor: colors.panel, borderColor: colors.line },
              ]}
            >
              {skills
                .filter((k) =>
                  k.name.toLowerCase().includes(text.slice(1).toLowerCase()),
                )
                .slice(0, 5)
                .map((k) => (
                  <Pressable
                    key={k.name}
                    onPress={() => setText("/" + k.name + " ")}
                    style={s.mention}
                  >
                    <Text style={{ color: colors.text, textAlign: "left" }}>
                      /{k.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ color: colors.muted, fontSize: 12 }}
                    >
                      {k.description}
                    </Text>
                  </Pressable>
                ))}
            </View>
          )}
          {choices.length > 0 && (
            <View
              style={[
                s.mentions,
                { backgroundColor: colors.panel, borderColor: colors.line },
              ]}
            >
              {choices.slice(0, 6).map((m) => (
                <Pressable
                  key={m.address}
                  onPress={() => selectMention(m)}
                  style={s.mention}
                >
                  <Text style={{ color: colors.text }}>@ {m.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {attachmentMenu && (
            <View
              style={[s.attachmentActions, { backgroundColor: colors.panel }]}
            >
              {button(
                "照片",
                () => {
                  setAttachmentMenu(false);
                  void chooseImage();
                },
                <ImagePlus size={20} color={colors.green} />,
                busy || offline || uploads.length >= 4,
              )}
              {button(
                "文件",
                () => {
                  setAttachmentMenu(false);
                  void chooseFile();
                },
                <Paperclip size={20} color={colors.green} />,
                busy || offline || uploads.length >= 4,
              )}
              {button(
                "粘贴图片",
                () => {
                  setAttachmentMenu(false);
                  void paste();
                },
                undefined,
                busy || offline || uploads.length >= 4,
              )}
            </View>
          )}
          <GlassSurface style={s.composer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加图片或文件"
              accessibilityState={{ expanded: attachmentMenu }}
              onPress={() => setAttachmentMenu(!attachmentMenu)}
              style={s.iconControl}
            >
              <Plus size={22} color={colors.text} />
            </Pressable>
            <TextInput
              accessibilityLabel="消息"
              multiline
              placeholder={"给" + room.title + "发消息…"}
              placeholderTextColor={colors.muted}
              value={text}
              onChangeText={(v) => {
                setTokens(rebaseMentions(text, v, tokens));
                setText(v);
              }}
              style={[s.input, { color: colors.text }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="发送"
              disabled={
                busy ||
                offline ||
                pendingRoom.length > 0 ||
                (!text.trim() && !uploads.length)
              }
              onPress={() => {
                Keyboard.dismiss();
                void send();
              }}
              style={[
                s.send,
                {
                  backgroundColor: colors.green,
                  opacity: busy || offline ? 0.4 : 1,
                },
              ]}
            >
              <ArrowUp size={20} color={colors.bg} />
            </Pressable>
          </GlassSurface>
        </KeyboardAvoidingView>
      )}
      {tab === "收件箱" && (
        <ScrollView contentContainerStyle={s.page}>
          <Text style={[s.sectionTitle, { color: colors.text }]}>
            需要你处理
          </Text>
          {!inbox?.approvals?.length && !inbox?.questions?.length && (
            <Text style={{ color: colors.muted }}>暂时没有待处理事项</Text>
          )}
          {inbox?.approvals?.map((a: any) => (
            <View
              key={a.id}
              style={[
                s.card,
                { backgroundColor: colors.panel, borderColor: colors.line },
              ]}
            >
              <Text style={[s.title, { color: colors.text }]}>
                {bots.find((b: any) => b.id === a.botId)?.name ?? "成员"}{" "}
                需要确认
              </Text>
              <Text style={{ color: colors.muted, marginVertical: 12 }}>
                {a.toolName}
              </Text>
              <Text
                selectable
                style={{
                  color: colors.text,
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                  fontSize: 12,
                }}
              >
                {a.display}
              </Text>
              <View style={s.actions}>
                {button(
                  "拒绝",
                  () => void decide(a, "deny"),
                  undefined,
                  busy || offline,
                )}
                {button(
                  "允许一次",
                  () => void decide(a, "allow_once"),
                  <Check size={16} color={colors.green} />,
                  busy || offline,
                )}
              </View>
            </View>
          ))}
          {inbox?.questions?.map((q: any) => (
            <Question
              key={q.id}
              q={q}
              colors={colors}
              onAnswer={async (answer: string) => {
                await call("questions.answer", {
                  operationId: uid(),
                  id: q.id,
                  answer,
                });
                setInbox(await call("inbox.read"));
              }}
            />
          ))}
        </ScrollView>
      )}
      {tab === "产物" && (
        <ScrollView contentContainerStyle={s.page}>
          <Text style={[s.sectionTitle, { color: colors.text }]}>
            生成的文件
          </Text>
          {button(
            "刷新文件",
            () => void requestFiles(),
            <RefreshCw size={16} color={colors.green} />,
          )}
          {!files.length && (
            <Text
              style={[s.caption, { color: colors.muted, marginVertical: 22 }]}
            >
              生成的报告、文档和图片会显示在这里。
            </Text>
          )}
          {files.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => void viewFile(f)}
              style={[s.row, { borderBottomColor: colors.line }]}
            >
              <FileText size={22} strokeWidth={1.6} color={colors.green} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 15 }}>
                  {f.name}
                </Text>
                <Text style={[s.caption, { color: colors.muted }]}>
                  {f.roomTitle} · {(f.bytes / 1024).toFixed(1)} KB
                </Text>
              </View>
              <ChevronRight size={17} color={colors.muted} />
            </Pressable>
          ))}
        </ScrollView>
      )}
      {tab === "我" && pairing && (
        <View style={s.pairingProgress} accessibilityLiveRegion="polite">
          <View style={[s.pairingSymbol, { backgroundColor: colors.user }]}>
            <Monitor size={40} strokeWidth={1.3} color={colors.green} />
          </View>
          <ActivityIndicator size="small" color={colors.green} />
          <Text
            style={[
              s.sectionTitle,
              {
                color: colors.text,
                textAlign: "center",
                marginTop: 18,
                marginBottom: 12,
              },
            ]}
          >
            {pairingPhase === "confirming" ? "请在电脑上确认" : "正在连接电脑"}
          </Text>
          <Text
            style={{ color: colors.text, fontSize: 17, textAlign: "center" }}
          >
            {pairingName}
          </Text>
          <Text
            style={[
              s.caption,
              {
                color: colors.muted,
                textAlign: "center",
                marginTop: 14,
                marginBottom: 28,
              },
            ]}
          >
            {pairingPhase === "confirming"
              ? "在电脑 KTeam 点“确认连接”，这里会自动进入团队。"
              : "请保持电脑唤醒，稍候即可。"}
          </Text>
          {button("取消连接", () => {
            cancelPair();
          })}
        </View>
      )}
      {tab === "我" && !pairing && (
        <ScrollView
          contentContainerStyle={s.page}
          keyboardShouldPersistTaps="handled"
        >
          {button(
            "返回",
            () => {
              const back = returnView.current;
              setTab(back?.tab ?? "会话");
              setRoom(back?.room);
            },
            <ArrowLeft size={18} color={colors.green} />,
          )}
          <Text style={[s.homeTitle, { color: colors.text, marginBottom: 12 }]}>
            电脑与连接
          </Text>
          <Text style={[s.caption, { color: colors.muted, marginBottom: 24 }]}>
            团队在电脑运行，手机让你随时参与。
          </Text>
          <Text style={[s.sectionTitle, { color: colors.text }]}>
            已连接电脑
          </Text>
          {saved.map((c) => (
            <View
              key={c.installationId}
              style={[
                s.card,
                { backgroundColor: colors.panel, borderColor: colors.line },
              ]}
            >
              <Text style={[s.title, { color: colors.text }]}>
                {c.computerName}
              </Text>
              <View style={s.actions}>
                {button(
                  c.credentialId === computer?.credentialId
                    ? offline
                      ? "重新连接此电脑"
                      : "当前电脑"
                    : "切换到此电脑",
                  () => {
                    void selectComputer(c);
                    setComputer(c);
                    if (c.credentialId === computer?.credentialId) reconnect();
                    setTab("会话");
                  },
                )}
                {button("移除", () =>
                  Alert.alert(
                    "移除此电脑？",
                    "仅移除手机上的连接，电脑可在设置中撤销设备权限。",
                    [
                      { text: "取消" },
                      {
                        text: "移除",
                        style: "destructive",
                        onPress: () =>
                          void forgetComputer(c).then(async () => {
                            const all = await computers();
                            setSaved(all);
                            if (c.credentialId === computer?.credentialId)
                              setComputer(all[0]);
                          }),
                      },
                    ],
                  ),
                )}
              </View>
            </View>
          ))}
          <Text style={[s.sectionTitle, { color: colors.text, marginTop: 24 }]}>
            连接新电脑
          </Text>
          <Text style={[s.caption, { color: colors.muted, marginBottom: 16 }]}>
            电脑侧栏点“连接手机”即可显示二维码。同一 Wi-Fi
            下扫码后，在电脑确认这部手机。
          </Text>
          {button(
            "扫描二维码",
            () => void startScan(),
            <QrCode size={18} color={colors.green} />,
            pairing,
          )}
          {!manualPair && !pairing && (
            <Pressable
              accessibilityRole="button"
              style={{ paddingVertical: 20 }}
              onPress={() => setManualPair(true)}
            >
              <Text style={{ color: colors.green }}>
                无法扫码？粘贴配对链接
              </Text>
            </Pressable>
          )}
          {manualPair && (
            <>
              <TextInput
                accessibilityLabel="配对链接"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="在此粘贴配对链接"
                placeholderTextColor={colors.muted}
                value={pairLink}
                onChangeText={setPairLink}
                style={[
                  s.linkInput,
                  {
                    color: colors.text,
                    borderColor: colors.line,
                    backgroundColor: colors.panel,
                  },
                ]}
              />
              {button(
                pairing ? "等待电脑确认…" : "连接",
                () => void pair(pairLink),
                <Smartphone size={18} color={colors.green} />,
                pairing || !pairLink,
              )}
            </>
          )}
          {pairing &&
            button("取消配对", () => {
              cancelPair();
            })}
          <Text style={[s.caption, { color: colors.muted, marginTop: 24 }]}>
            手机不保存模型密钥。电脑离线时可查看已同步内容并编辑草稿。
          </Text>
          <View style={{ marginTop: 24 }}>
            {button("开源许可", () =>
              setPreview({ kind: "licenses", name: "开源许可" }),
            )}
          </View>
        </ScrollView>
      )}
      {!room && computer && tab !== "我" && (
        <GlassSurface style={[s.tabs, { bottom: Math.max(insets.bottom, 14) }]}>
          {(
            [
              ["会话", "团队", MessageCircle],
              ["收件箱", "待办", Inbox],
              ["产物", "产物", FolderOpen],
            ] as const
          ).map(([value, label, Icon]) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: tab === value }}
              onPress={() => {
                setTab(value);
                if (value === "产物") void requestFiles();
                if (value === "收件箱")
                  void call("inbox.read").then(setInbox).catch(tell);
              }}
              style={[s.tab, tab === value && { backgroundColor: colors.user }]}
            >
              <Icon
                size={22}
                strokeWidth={1.7}
                color={tab === value ? colors.green : colors.muted}
              />
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: tab === value ? "600" : "400",
                  color: tab === value ? colors.green : colors.muted,
                }}
              >
                {label}
              </Text>
              {value === "收件箱" &&
                !!(
                  (inbox?.approvals?.length ?? 0) +
                  (inbox?.questions?.length ?? 0)
                ) && (
                  <View style={[s.dot, { backgroundColor: colors.green }]} />
                )}
            </Pressable>
          ))}
        </GlassSurface>
      )}
      <Modal
        visible={scan}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setScan(false)}
      >
        <View style={{ flex: 1, backgroundColor: "#111914" }}>
          {scan && (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onMountError={() =>
                setScanError("相机暂不可用，请检查权限，或改用粘贴链接")
              }
              onBarcodeScanned={(r) => {
                if (scanConsumed.current || pairingActive.current) return;
                try {
                  parseInvitation(r.data);
                } catch (e) {
                  setScanError(
                    errorText(e).includes("过期")
                      ? "二维码已过期，请在电脑上刷新"
                      : "这不是 KTeam 配对二维码，请对准电脑上的二维码",
                  );
                  return;
                }
                scanConsumed.current = true;
                setScan(false);
                setTorch(false);
                void pair(r.data);
              }}
            />
          )}
          <View
            pointerEvents="none"
            collapsable={false}
            renderToHardwareTextureAndroid
            style={s.scanShade}
          >
            <View style={s.scanShadeTop} />
            <View style={s.scanMiddle}>
              <View style={s.scanShadeSide} />
              <View style={s.scanTarget} accessibilityLabel="二维码对准框">
                <View style={[s.scanCorner, s.scanTopLeft]} />
                <View style={[s.scanCorner, s.scanTopRight]} />
                <View style={[s.scanCorner, s.scanBottomLeft]} />
                <View style={[s.scanCorner, s.scanBottomRight]} />
              </View>
              <View style={s.scanShadeSide} />
            </View>
            <View style={s.scanShadeBottom} />
          </View>
          <SafeAreaView collapsable={false} style={s.scanChrome}>
            <View style={s.scanHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭扫码"
                onPress={() => setScan(false)}
                style={s.scanClose}
              >
                <X size={23} color="white" />
              </Pressable>
              <Text style={{ color: "white", fontSize: 18, fontWeight: "600" }}>
                连接电脑
              </Text>
              <View style={{ width: 44 }} />
            </View>
            <View style={s.scanInstruction} pointerEvents="none">
              <Text
                style={{
                  color: "white",
                  fontSize: 23,
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                将二维码放入框内
              </Text>
              <Text
                style={{
                  color: "#d8e2d8",
                  fontSize: 14,
                  textAlign: "center",
                  marginTop: 12,
                }}
              >
                电脑 KTeam → 连接手机
              </Text>
            </View>
            <View style={s.scanFooter}>
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: scanError ? "#ffe0ba" : "white",
                  textAlign: "center",
                  fontSize: 14,
                  lineHeight: 22,
                  marginBottom: 24,
                }}
              >
                {scanError || "识别后自动连接，无需再次点击"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={torch ? "关闭手电筒" : "打开手电筒"}
                onPress={() => setTorch(!torch)}
                style={s.scanTorch}
              >
                {torch ? (
                  <ZapOff size={23} color="white" />
                ) : (
                  <Zap size={23} color="white" />
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setScan(false);
                  setManualPair(true);
                  setTab("我");
                }}
                style={{ padding: 20 }}
              >
                <Text style={{ color: "white", fontSize: 14 }}>
                  无法扫码？粘贴链接
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
      <Modal
        visible={!!preview}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closePreview}
      >
        <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
          <View style={[s.header, { borderBottomColor: colors.line }]}>
            <FileText size={19} color={colors.green} />
            <Text
              numberOfLines={1}
              style={{ flex: 1, color: colors.text, fontWeight: "600" }}
            >
              {preview?.name ?? "产物查看器"}
            </Text>
            {button("关闭", closePreview, <X size={18} color={colors.text} />)}
          </View>
          {preview?.loading ? (
            <Text style={{ padding: 24, color: colors.muted }}>正在读取…</Text>
          ) : preview?.kind === "licenses" ? (
            <FlatList
              data={notices}
              keyExtractor={(n) => n.name + "@" + n.version}
              renderItem={({ item: n }) => (
                <Pressable
                  onPress={() =>
                    setPreview({
                      kind: "text",
                      name: n.name + " " + n.version,
                      content: n.text,
                    })
                  }
                  style={[s.row, { borderBottomColor: colors.line }]}
                >
                  <Text style={{ color: colors.text, flex: 1 }}>
                    {n.name} {n.version}
                  </Text>
                  <Text style={{ color: colors.muted }}>{n.license}</Text>
                </Pressable>
              )}
            />
          ) : preview?.kind === "html" ? (
            <WebView
              source={{ html: safeHTML(preview.content) }}
              javaScriptEnabled={false}
              domStorageEnabled={false}
              allowFileAccess={false}
              originWhitelist={["about:blank"]}
              onShouldStartLoadWithRequest={(r) => r.url === "about:blank"}
              setSupportMultipleWindows={false}
              style={{ flex: 1, backgroundColor: colors.panel }}
            />
          ) : preview?.kind === "image" ? (
            <ScrollView
              maximumZoomScale={4}
              minimumZoomScale={1}
              contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
            >
              <Image
                accessibilityLabel={preview.name}
                resizeMode="contain"
                source={{
                  uri:
                    "data:" + preview.mediaType + ";base64," + preview.content,
                }}
                style={{ width: "100%", height: 500 }}
              />
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={s.page}>
              {preview?.kind === "markdown" ? (
                <Markdown
                  style={{
                    body: { color: colors.text, fontSize: 15, lineHeight: 24 },
                    heading1: { fontSize: 28, lineHeight: 36 },
                    heading2: { fontSize: 24, lineHeight: 32 },
                    heading3: { fontSize: 20, lineHeight: 28 },
                  }}
                  onLinkPress={(url) => {
                    if (/^https?:\/\//i.test(url)) void Linking.openURL(url);
                    return false;
                  }}
                >
                  {preview.content}
                </Markdown>
              ) : (
                <Text selectable style={{ color: colors.text }}>
                  {preview?.kind === "unsupported"
                    ? "此文件暂不支持手机预览，请在电脑核对。"
                    : preview?.content}
                </Text>
              )}
            </ScrollView>
          )}
          {preview?.error && (
            <View style={s.page}>
              <Text style={{ color: colors.text }}>
                暂时无法打开：{preview.error}
              </Text>
              {button("重试", () => void viewFile(preview.retry))}
            </View>
          )}
          {preview?.content &&
            button("系统分享 / 外部打开", () => {
              void (async () => {
                const f = new File(
                  Paths.cache,
                  "kteam-preview-" +
                    uid() +
                    "-" +
                    String(preview.name).replace(/[^\p{L}\p{N}._-]/gu, "_"),
                );
                f.write(
                  preview.kind === "image"
                    ? new Uint8Array(Buffer.from(preview.content, "base64"))
                    : preview.content,
                );
                await Sharing.shareAsync(f.uri);
              })().catch(tell);
            })}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
function Attachment({ message, file, call, onOpen, colors }: any) {
  const [data, setData] = useState<any>();
  useEffect(() => {
    let current = true;
    void call("attachments.preview", {
      roomId: message.roomId,
      messageId: message.messageId,
      fileId: file.fileId,
    })
      .then((v: any) => {
        if (current) setData(v);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [message.messageId, file.fileId]);
  const image = data?.image;
  return (
    <Pressable
      onPress={() => {
        if (image)
          onOpen({
            kind: "image",
            name: file.name,
            mediaType: image.mediaType,
            content: image.base64,
          });
        else if (data?.preview !== undefined)
          onOpen({
            kind: file.extension === "md" ? "markdown" : "text",
            name: file.name,
            content: data.preview,
          });
      }}
      style={[s.file, { borderColor: colors.line }]}
    >
      {image ? (
        <Image
          accessibilityLabel={file.name}
          source={{
            uri: "data:" + image.mediaType + ";base64," + image.base64,
          }}
          style={{ width: 180, height: 120, borderRadius: 10 }}
        />
      ) : (
        <>
          <FileText size={16} color={colors.green} />
          <Text style={{ color: colors.green }}>{file.name}</Text>
        </>
      )}
    </Pressable>
  );
}
function Question({ q, colors, onAnswer }: any) {
  const [answer, setAnswer] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <View
      style={[
        s.card,
        { backgroundColor: colors.panel, borderColor: colors.line },
      ]}
    >
      <Text style={[s.title, { color: colors.text }]}>{q.question}</Text>
      <TextInput
        accessibilityLabel="回答问题"
        multiline
        value={answer}
        onChangeText={setAnswer}
        style={[s.search, { color: colors.text, borderColor: colors.line }]}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy || !answer.trim()}
        onPress={() => {
          setBusy(true);
          void onAnswer(answer)
            .catch((e: any) => setError(errorText(e)))
            .finally(() => setBusy(false));
        }}
        style={s.button}
      >
        <Text style={{ color: colors.green }}>发送回答</Text>
      </Pressable>
      {error && <Text style={{ color: colors.muted }}>{error}</Text>}
    </View>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <AppBody />
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1 },
  pairingProgress: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  pairingSymbol: {
    width: 104,
    height: 104,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 30,
  },
  scanShade: {
    zIndex: 1,
    elevation: 1,
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  scanShadeTop: { flex: 1, backgroundColor: "#0009" },
  scanMiddle: { height: 252, flexDirection: "row" },
  scanShadeSide: { flex: 1, backgroundColor: "#0009" },
  scanShadeBottom: { flex: 1, backgroundColor: "#0009" },
  scanTarget: { width: 252, height: 252 },
  scanCorner: {
    position: "absolute",
    width: 34,
    height: 34,
    borderColor: "#e9f8e9",
  },
  scanTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 18,
  },
  scanTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 18,
  },
  scanBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 18,
  },
  scanBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 18,
  },
  scanChrome: {
    zIndex: 2,
    elevation: 2,
    flex: 1,
    justifyContent: "space-between",
  },
  scanHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  scanClose: {
    height: 44,
    width: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff22",
  },
  scanInstruction: { position: "absolute", top: "21%", left: 20, right: 20 },
  scanFooter: {
    alignItems: "center",
    paddingHorizontal: 30,
    paddingBottom: 18,
  },
  scanTorch: {
    height: 50,
    width: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff22",
  },
  header: {
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brand: { fontSize: 23, fontWeight: "700", letterSpacing: -0.8 },
  ambient: {
    position: "absolute",
    width: 360,
    height: 360,
    borderRadius: 180,
    top: -200,
    right: -100,
    opacity: 0.4,
  },
  computerPill: { borderRadius: 24 },
  computerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 13,
    minHeight: 42,
  },
  circleControl: { borderRadius: 24 },
  iconControl: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  assistantCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 22,
    borderRadius: 28,
    marginBottom: 12,
    minHeight: 120,
  },
  assistantMark: {
    height: 54,
    width: 54,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  attentionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    marginBottom: 6,
  },
  homeHeading: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 },
  homeTitle: {
    fontSize: 32,
    lineHeight: 41,
    fontWeight: "600",
    letterSpacing: -1,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginTop: 24,
  },
  roomCard: {
    padding: 18,
    minHeight: 90,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 24,
    marginBottom: 10,
  },
  welcome: {
    flexGrow: 1,
    paddingHorizontal: 30,
    paddingTop: 34,
    paddingBottom: 30,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 2,
    marginBottom: 16,
  },
  welcomeTitle: {
    fontSize: 38,
    lineHeight: 49,
    fontWeight: "600",
    letterSpacing: -1.5,
  },
  welcomeCopy: { fontSize: 16, lineHeight: 26, marginTop: 18 },
  pairIllustration: {
    height: 240,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 12,
  },
  computerSketch: {
    width: 210,
    height: 160,
    borderWidth: 1,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-6deg" }],
  },
  sketchDots: {
    position: "absolute",
    top: 12,
    left: 14,
    flexDirection: "row",
    gap: 4,
  },
  sketchDot: { width: 4, height: 4, borderRadius: 2 },
  sketchLine: { width: 100, height: 5, borderRadius: 3, marginTop: 10 },
  phoneSketch: {
    position: "absolute",
    width: 94,
    height: 135,
    right: 16,
    bottom: 18,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "10deg" }],
  },
  primaryAction: {
    minHeight: 58,
    borderRadius: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  artifactCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 14,
    marginTop: 12,
    minWidth: 230,
    maxWidth: "100%",
  },
  attachmentActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 12,
    marginHorizontal: 16,
    borderRadius: 22,
    marginBottom: 10,
  },
  title: { fontSize: 16, fontWeight: "600", lineHeight: 23 },
  caption: { fontSize: 12, lineHeight: 19 },
  sectionTitle: { fontSize: 22, fontWeight: "600", marginBottom: 20 },
  button: {
    minHeight: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  search: {
    margin: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    fontSize: 15,
  },
  row: {
    padding: 16,
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    paddingBottom: 80,
  },
  page: { padding: 24, paddingBottom: 120 },
  card: {
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    marginBottom: 14,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  tabs: {
    position: "absolute",
    bottom: 14,
    left: 24,
    right: 24,
    flexDirection: "row",
    padding: 7,
    borderRadius: 38,
    shadowColor: "#13271a",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    borderRadius: 30,
  },
  message: {
    maxWidth: "94%",
    minWidth: 100,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginVertical: 7,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  file: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 13,
    padding: 9,
    marginTop: 10,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 5,
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 7,
    borderRadius: 30,
  },
  input: {
    flex: 1,
    paddingHorizontal: 7,
    paddingVertical: 8,
    fontSize: 15,
    maxHeight: 160,
    minHeight: 38,
  },
  send: {
    height: 37,
    width: 37,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  pending: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  error: { padding: 12, margin: 10, borderRadius: 12 },
  latest: {
    position: "absolute",
    bottom: 12,
    right: 18,
    borderWidth: StyleSheet.hairlineWidth,
    width: 42,
    height: 42,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  mentions: {
    marginHorizontal: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 15,
    padding: 4,
  },
  mention: { padding: 12 },
  linkInput: {
    minHeight: 100,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    marginVertical: 16,
    fontSize: 13,
  },
});
