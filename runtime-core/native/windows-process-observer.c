#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0600
#include <windows.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <wchar.h>
#include <errno.h>
#include <stdlib.h>

/* Read-only OS process metadata. No command line, environment, signalling or writes. */
static int birth(const wchar_t *text) {
    wchar_t *end = NULL;
    unsigned long pid;
    HANDLE process;
    FILETIME created, exited, kernel, user;
    SYSTEMTIME time;
    ULARGE_INTEGER ticks;
    const wchar_t *p;
    if (!*text) return 2;
    for (p = text; *p; p++) if (*p < L'0' || *p > L'9') return 2;
    errno = 0; pid = wcstoul(text, &end, 10);
    if (errno || !pid || end == NULL || *end) return 2;
    process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, (DWORD)pid);
    if (process == NULL) return GetLastError() == ERROR_INVALID_PARAMETER ? 0 : 2;
    if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) { CloseHandle(process); return 2; }
    CloseHandle(process);
    if (!FileTimeToSystemTime(&created, &time)) return 2;
    ticks.LowPart = created.dwLowDateTime; ticks.HighPart = created.dwHighDateTime;
    /* Win32_Process CreationDate has microsecond precision. Keep its ISO token format. */
    printf("%04u-%02u-%02uT%02u:%02u:%02u.%07lluZ\n", (unsigned)time.wYear,
        (unsigned)time.wMonth, (unsigned)time.wDay, (unsigned)time.wHour,
        (unsigned)time.wMinute, (unsigned)time.wSecond,
        (unsigned long long)((ticks.QuadPart % 10000000ULL) / 10ULL * 10ULL));
    return 0;
}
static int census(void) {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    PROCESSENTRY32W entry;
    DWORD error, count = 0;
    if (snapshot == INVALID_HANDLE_VALUE) return 2;
    ZeroMemory(&entry, sizeof(entry)); entry.dwSize = sizeof(entry);
    if (!Process32FirstW(snapshot, &entry)) { CloseHandle(snapshot); return 2; }
    do {
        if (++count > 100000) { CloseHandle(snapshot); return 2; }
        if (entry.th32ProcessID != 0 && entry.th32ProcessID != GetCurrentProcessId() &&
            _wcsicmp(entry.szExeFile, L"conhost.exe") != 0)
            printf("%lu %lu\n", entry.th32ProcessID, entry.th32ParentProcessID);
    } while (Process32NextW(snapshot, &entry));
    error = GetLastError(); CloseHandle(snapshot);
    return error == ERROR_NO_MORE_FILES ? 0 : 2;
}
/* Keep every exclusive observation handle until the complete walk finishes.
 * Never read file content, follow reparse points, rename, truncate or delete.
 * Sharing conflicts mean used; every other uncertainty remains unknown. */
#define MAX_ENTRIES 10000
static HANDLE held[MAX_ENTRIES];
static DWORD held_count = 0;
enum usage { UNKNOWN, FREE, USED };
static enum usage inspect_usage(const wchar_t *path, unsigned depth) {
    HANDLE metadata = INVALID_HANDLE_VALUE, exclusive = INVALID_HANDLE_VALUE, search = INVALID_HANDLE_VALUE;
    BY_HANDLE_FILE_INFORMATION before, after;
    WIN32_FIND_DATAW item;
    DWORD attributes, error;
    size_t length = wcslen(path);
    wchar_t *child_path = NULL;
    enum usage result = UNKNOWN;
    if (depth > 64 || held_count >= MAX_ENTRIES || length > 32767 - 261) goto done;
    attributes = GetFileAttributesW(path);
    if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT)) goto done;
    metadata = CreateFileW(path, FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        NULL, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, NULL);
    if (metadata == INVALID_HANDLE_VALUE || GetFileType(metadata) != FILE_TYPE_DISK ||
        !GetFileInformationByHandle(metadata, &before) || (before.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
        (!(before.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && before.nNumberOfLinks != 1)) goto done;
    if (before.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
        child_path = (wchar_t *)HeapAlloc(GetProcessHeap(), 0, (length + 262) * sizeof(wchar_t));
        if (child_path == NULL) goto done;
        if (swprintf_s(child_path, length + 262, L"%ls\\*", path) < 0) goto done;
        search = FindFirstFileW(child_path, &item);
        if (search == INVALID_HANDLE_VALUE) {
            if (GetLastError() != ERROR_FILE_NOT_FOUND) goto done;
        } else {
            do {
                enum usage child;
                if (wcscmp(item.cFileName, L".") == 0 || wcscmp(item.cFileName, L"..") == 0) continue;
                if (swprintf_s(child_path, length + 262, L"%ls\\%ls", path, item.cFileName) < 0) goto done;
                child = inspect_usage(child_path, depth + 1);
                if (child != FREE) { result = child; goto done; }
            } while (FindNextFileW(search, &item));
            error = GetLastError(); FindClose(search); search = INVALID_HANDLE_VALUE;
            if (error != ERROR_NO_MORE_FILES) goto done;
        }
    }
    exclusive = CreateFileW(path, FILE_READ_ATTRIBUTES | DELETE, 0, NULL, OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, NULL);
    if (exclusive == INVALID_HANDLE_VALUE) {
        error = GetLastError();
        result = error == ERROR_SHARING_VIOLATION || error == ERROR_LOCK_VIOLATION ? USED : UNKNOWN;
        goto done;
    }
    if (!GetFileInformationByHandle(exclusive, &after) || after.dwVolumeSerialNumber != before.dwVolumeSerialNumber ||
        after.nFileIndexHigh != before.nFileIndexHigh || after.nFileIndexLow != before.nFileIndexLow ||
        (after.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
        (!(after.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && after.nNumberOfLinks != 1) ||
        CompareFileTime(&before.ftLastWriteTime, &after.ftLastWriteTime) != 0 || held_count >= MAX_ENTRIES) goto done;
    held[held_count++] = exclusive; exclusive = INVALID_HANDLE_VALUE; result = FREE;
done:
    if (search != INVALID_HANDLE_VALUE) FindClose(search);
    if (exclusive != INVALID_HANDLE_VALUE) CloseHandle(exclusive);
    if (metadata != INVALID_HANDLE_VALUE) CloseHandle(metadata);
    if (child_path != NULL) HeapFree(GetProcessHeap(), 0, child_path);
    return result;
}
int wmain(int argc, wchar_t **argv) {
    if (argc == 1) return census();
    if (argc == 3 && wcscmp(argv[1], L"birth") == 0) return birth(argv[2]);
    if (argc == 3 && wcscmp(argv[1], L"usage") == 0 && argv[2][0] && wcslen(argv[2]) <= 32767) {
        enum usage result = inspect_usage(argv[2], 0);
        while (held_count) CloseHandle(held[--held_count]);
        puts(result == FREE ? "free" : result == USED ? "used" : "unknown");
        return 0;
    }
    return 2;
}
