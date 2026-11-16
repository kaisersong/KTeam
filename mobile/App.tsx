import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
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
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
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
  Inbox,
  MessageCircle,
  Paperclip,
  Plus,
  QrCode,
  RefreshCw,
  Settings,
  Smartphone,
  X,
} from "lucide-react-native";
import { Buffer } from "buffer";
import notices from "./third-party-notices.json";
import {
  MobileConnection,
  pairingComputer,
  parseInvitation,
  type Computer,
} from "./src/transport";
import {
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
const uid = () => Crypto.randomUUID().replace(/-/g, "");
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const names: Record<string, string> = {
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
function AppBody() {
  const dark = useColorScheme() === "dark",
    colors = {
      bg: dark ? "#141b17" : "#f8faf7",
      panel: dark ? "#202a23" : "#ffffff",
      text: dark ? "#edf3e9" : "#24372a",
      muted: dark ? "#9eae9b" : "#74816f",
      line: dark ? "#354235" : "#e1e8de",
      green: dark ? "#a8d3ae" : "#276747",
      user: dark ? "#314331" : "#e6efe2",
    };
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
    [scan, setScan] = useState(false),
    [pairLink, setPairLink] = useState(""),
    [pairing, setPairing] = useState(false),
    [uploads, setUploads] = useState<any[]>([]),
    [uncertain, setUncertain] = useState<any[]>([]),
    [reply, setReply] = useState<any>(),
    [preview, setPreview] = useState<any>(),
    [latest, setLatest] = useState(true),
    [permission, requestPermission] = useCameraPermissions();
  const connection = useRef<MobileConnection | undefined>(undefined),
    generation = useRef(0),
    roomRef = useRef<any>(undefined),
    messagesRef = useRef<any[]>([]),
    cursor = useRef<string | undefined>(undefined),
    active = useRef(AppState.currentState === "active"),
    refreshing = useRef(false),
    list = useRef<FlatList>(null),
    pairGeneration = useRef(0);
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
    if (refreshing.current || !computer || !active.current) return;
    refreshing.current = true;
    const g = generation.current,
      r = roomRef.current;
    try {
      if (!r) {
        const [a, b, c] = await Promise.all([
          call("rooms.list"),
          call("bots.list"),
          call("inbox.read"),
        ]);
        if (g !== generation.current) return;
        setRooms(a.rooms);
        setBots(b.bots);
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
        const incoming = v.messages?.messages ?? [],
          all = [
            ...new Map(
              [...messagesRef.current, ...incoming].map((m: any) => [
                m.messageId,
                m,
              ]),
            ).values(),
          ].sort((a: any, b: any) => a.roomSequence - b.roomSequence);
        setMessages(all);
        if (v.work) setWork(v.work);
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
                  bots.find((b) => b.id === m.subject.logicalAgentId)?.name ??
                  "成员",
                botId: m.subject.logicalAgentId,
              })),
          );
        await persist(computer, "room:" + r.roomId, all.slice(-100));
      }
      if (g === generation.current) {
        setOffline(false);
        setStatus(connection.current?.route ?? "已连接");
        setError("");
        await getPending(computer);
      }
    } catch (e) {
      if (g === generation.current) {
        setOffline(true);
        setStatus("离线 · 显示已同步内容");
        tell(e);
      }
    } finally {
      refreshing.current = false;
    }
  }, [computer, call, bots]);
  useEffect(() => {
    void computers().then((v) => {
      setSaved(v);
      if (v[0]) setComputer(v[0]);
    });
    const sub = AppState.addEventListener("change", (s) => {
      active.current = s === "active";
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    generation.current++;
    connection.current?.close();
    cursor.current = undefined;
    setMessages([]);
    setRooms([]);
    setBots([]);
    setInbox(undefined);
    setFiles([]);
    setUncertain([]);
    setRoom(undefined);
    setWork(undefined);
    setUploads([]);
    if (!computer) {
      connection.current = undefined;
      return;
    }
    const c = computer,
      transport = new MobileConnection(c);
    connection.current = transport;
    setStatus("连接中…");
    void Promise.all([readCache(c, "rooms"), readCache(c, "bots")])
      .then(([r, b]) => {
        if (connection.current !== transport) return;
        if (r) setRooms(r);
        if (b) setBots(b);
      })
      .catch(() => {});
    void refresh();
    const network = Network.addNetworkStateListener(() => {
      if (active.current) void refresh();
    });
    return () => {
      network.remove();
      transport.close();
    };
  }, [computer?.credentialId]);
  useEffect(() => {
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    if (!computer) return;
    cursor.current = undefined;
    setDraftReady(false);
    generation.current++;
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
      void readCache(computer, "room:" + r.roomId)
        .then((v) => {
          if (
            g === generation.current &&
            roomRef.current?.roomId === r.roomId &&
            v
          )
            setMessages(v);
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
        setPairLink(url);
        setTab("我");
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
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (room) {
        setRoom(undefined);
        return true;
      }
      if (tab !== "会话") {
        pairGeneration.current++;
        setPairing(false);
        setTab("会话");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [room, tab]);
  const pair = async (link: string) => {
    const attempt = ++pairGeneration.current;
    setPairing(true);
    setScan(false);
    setError("");
    let transport: MobileConnection | undefined;
    try {
      const invite = parseInvitation(link),
        candidate = pairingComputer(invite);
      transport = new MobileConnection(candidate);
      await transport.connect();
      setStatus("请在电脑确认这部手机");
      while (
        attempt === pairGeneration.current &&
        Date.now() < invite.expiresAt
      ) {
        const v = await transport.call("pair", {
          name: Platform.OS === "ios" ? "我的 iPhone" : "我的 Android",
        });
        if (v.paired) {
          const c = {
            ...candidate,
            credentialId: v.deviceId,
            secret: v.secret,
          };
          await saveComputer(c);
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
      tell(e);
    } finally {
      transport?.close();
      if (attempt === pairGeneration.current) setPairing(false);
    }
  };
  const openRoom = (r: any) => {
    setRoom(r);
    setTab("会话");
  };
  const loadOlder = async () => {
    if (busy || !room || !messages.length) return;
    setBusy(true);
    try {
      const v = await call("messages.page", {
        roomId: room.roomId,
        before: messages[0].roomSequence,
      });
      setMessages((old) =>
        [
          ...new Map(
            [...v.messages, ...old].map((m: any) => [m.messageId, m]),
          ).values(),
        ].sort((a: any, b: any) => a.roomSequence - b.roomSequence),
      );
    } catch (e) {
      tell(e);
    } finally {
      setBusy(false);
    }
  };
  const viewFile = async (file: any) => {
    setPreview({ name: file.name, loading: true });
    try {
      const v = await call("artifacts.preview", {
        roomId: room?.roomId ?? file.roomId,
        toolCallId: file.toolCallId ?? file.id,
      });
      setPreview(v);
    } catch (e) {
      setPreview(undefined);
      tell(e);
    }
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
  const filtered = rooms.filter((r) =>
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
  const pendingRoom = uncertain.filter((v) => v.input?.roomId === room?.roomId);
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <StatusBar style={dark ? "light" : "dark"} />
      <View style={[s.header, { borderBottomColor: colors.line }]}>
        {room ? (
          button(
            "返回",
            () => setRoom(undefined),
            <ArrowLeft color={colors.text} size={18} />,
          )
        ) : (
          <Text style={[s.brand, { color: colors.text }]}>KTeam</Text>
        )}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[s.title, { color: colors.text }]}>
            {room?.title ?? computer?.computerName ?? "你的 AI 团队"}
          </Text>
          <Text style={[s.caption, { color: colors.muted }]}>{status}</Text>
        </View>
        {button(
          "刷新",
          () => void refresh(),
          <RefreshCw size={17} color={colors.muted} />,
        )}
      </View>
      {error ? (
        <Pressable
          onPress={() => setError("")}
          style={[s.error, { backgroundColor: colors.user }]}
        >
          <Text style={{ color: colors.text }}>{error}</Text>
        </Pressable>
      ) : null}
      {tab === "会话" && !room && (
        <View style={{ flex: 1 }}>
          <TextInput
            accessibilityLabel="搜索会话"
            placeholder="搜索会话"
            placeholderTextColor={colors.muted}
            value={queryText}
            onChangeText={setQueryText}
            style={[
              s.search,
              {
                backgroundColor: colors.panel,
                color: colors.text,
                borderColor: colors.line,
              },
            ]}
          />
          {!computer ? (
            <View style={s.empty}>
              <Smartphone size={42} strokeWidth={1.4} color={colors.green} />
              <Text style={[s.title, { color: colors.text, marginTop: 16 }]}>
                把电脑里的团队带在身边
              </Text>
              <Text
                style={[s.caption, { color: colors.muted, marginVertical: 12 }]}
              >
                连接后继续原来的会话，无需再次设置模型。
              </Text>
              {button(
                "连接电脑",
                () => setTab("我"),
                <Plus size={16} color={colors.green} />,
              )}
            </View>
          ) : (
            <FlatList
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
                  style={[s.row, { borderBottomColor: colors.line }]}
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
              data={[...messages].reverse()}
              inverted
              keyExtractor={(m) => m.messageId}
              onEndReached={() => void loadOlder()}
              onEndReachedThreshold={0.1}
              onScroll={(e) => setLatest(e.nativeEvent.contentOffset.y < 100)}
              onViewableItemsChanged={markSeen}
              viewabilityConfig={{
                itemVisiblePercentThreshold: 100,
                minimumViewTime: 1000,
              }}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              contentContainerStyle={{ padding: 16 }}
              renderItem={({ item: m }) => {
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
                        alignSelf:
                          m.sender.kind === "user" ? "flex-end" : "flex-start",
                        backgroundColor:
                          m.sender.kind === "user" ? colors.user : colors.panel,
                        borderColor: colors.line,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        s.caption,
                        { color: colors.muted, marginBottom: 5 },
                      ]}
                    >
                      {m.sender.kind === "user"
                        ? "我"
                        : (bots.find((b) => b.id === m.sender.logicalAgentId)
                            ?.name ?? "成员")}
                    </Text>
                    <Pressable
                      onLongPress={() =>
                        Alert.alert("消息", "", [
                          {
                            text: "复制",
                            onPress: () =>
                              void Clipboard.setStringAsync(
                                messageDisplayText(m),
                              ),
                          },
                          { text: "回复", onPress: () => setReply(m) },
                          { text: "取消" },
                        ] as any)
                      }
                    >
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
                            filename =
                              decodeURIComponent(url).split("/").pop() ?? "";
                          } catch {}
                          const found = receipts.filter(
                            (f: any) => (f.file?.name ?? f.name) === filename,
                          );
                          if (found.length === 1) void viewFile(found[0]);
                          else if (/^https?:\/\//i.test(url))
                            void Linking.openURL(url);
                          return false;
                        }}
                      >
                        {messageDisplayText(m)}
                      </Markdown>
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
                        style={[s.file, { borderColor: colors.line }]}
                      >
                        <FileText
                          size={16}
                          strokeWidth={1.6}
                          color={colors.green}
                        />
                        <Text style={{ color: colors.green, flexShrink: 1 }}>
                          {f.file?.name ?? f.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                );
              }}
            />
            {!latest && (
              <Pressable
                accessibilityLabel="到最新消息"
                onPress={() => list.current?.scrollToOffset({ offset: 0 })}
                style={[
                  s.latest,
                  { backgroundColor: colors.panel, borderColor: colors.line },
                ]}
              >
                <ArrowDown size={22} color={colors.text} />
              </Pressable>
            )}
          </View>
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
                {bots.find((b) => b.id === j.activeBotId)?.name ?? "成员"}{" "}
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
          <View
            style={[
              s.composer,
              { backgroundColor: colors.panel, borderColor: colors.line },
            ]}
          >
            {button(
              "图片",
              () => void chooseImage(),
              <ImagePlus size={19} color={colors.muted} />,
              busy || uploads.length >= 4 || offline,
            )}
            {button(
              "文件",
              () => void chooseFile(),
              <Paperclip size={19} color={colors.muted} />,
              busy || uploads.length >= 4 || offline,
            )}
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
          </View>
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
                {bots.find((b) => b.id === a.botId)?.name ?? "成员"} 需要确认
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
      {tab === "我" && (
        <ScrollView
          contentContainerStyle={s.page}
          keyboardShouldPersistTaps="handled"
        >
          {button("开源许可", () =>
            setPreview({ kind: "licenses", name: "开源许可" }),
          )}
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
                    ? "当前电脑"
                    : "切换到此电脑",
                  () => {
                    void selectComputer(c);
                    setComputer(c);
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
            在电脑 KTeam 的设置中打开“手机连接”，扫描二维码。
          </Text>
          {button(
            "扫描二维码",
            () => {
              if (permission?.granted) setScan(true);
              else
                void requestPermission().then((p) => {
                  if (p.granted) setScan(true);
                });
            },
            <QrCode size={18} color={colors.green} />,
            pairing,
          )}
          <TextInput
            accessibilityLabel="配对链接"
            multiline
            placeholder="或粘贴 kteam:// 配对链接"
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
          {pairing &&
            button("取消配对", () => {
              pairGeneration.current++;
              setPairing(false);
            })}
          <Text style={[s.caption, { color: colors.muted, marginTop: 24 }]}>
            手机不保存模型密钥。电脑离线时可以查看有效缓存并编辑草稿，操作不会离线自动执行。
          </Text>
        </ScrollView>
      )}
      {!room && (
        <View
          style={[
            s.tabs,
            { backgroundColor: colors.panel, borderTopColor: colors.line },
          ]}
        >
          {[
            ["会话", MessageCircle],
            ["收件箱", Inbox],
            ["产物", FolderOpen],
            ["我", Settings],
          ].map(([label, Icon]: any) => (
            <Pressable
              key={label}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === label }}
              onPress={() => {
                setTab(label);
                if (label === "产物") void requestFiles();
                if (label === "收件箱")
                  void call("inbox.read").then(setInbox).catch(tell);
              }}
              style={s.tab}
            >
              <Icon
                size={21}
                strokeWidth={1.6}
                color={tab === label ? colors.green : colors.muted}
              />
              <Text
                style={{
                  fontSize: 11,
                  color: tab === label ? colors.green : colors.muted,
                  marginTop: 4,
                }}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Modal
        visible={scan}
        animationType="slide"
        onRequestClose={() => setScan(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          {button(
            "取消扫码",
            () => setScan(false),
            <X size={18} color={colors.text} />,
          )}
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={(r) => {
              setScan(false);
              setPairLink(r.data);
              void pair(r.data);
            }}
          />
        </SafeAreaView>
      </Modal>
      <Modal
        visible={!!preview}
        animationType="slide"
        onRequestClose={() => setPreview(undefined)}
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
            {button(
              "关闭",
              () => setPreview(undefined),
              <X size={18} color={colors.text} />,
            )}
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
  header: {
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  brand: { fontSize: 23, fontWeight: "700", marginRight: 4 },
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
  page: { padding: 20, paddingBottom: 40 },
  card: {
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    marginBottom: 14,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  tabs: {
    flexDirection: "row",
    paddingTop: 10,
    paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: { flex: 1, alignItems: "center", minHeight: 50 },
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
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
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
