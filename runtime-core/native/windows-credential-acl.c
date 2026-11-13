#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0600
#include <windows.h>
#include <aclapi.h>
#include <stdio.h>
#include <wchar.h>

/* Only ACL maintenance for the caller's existing credential bucket; no data IO.
 * https://learn.microsoft.com/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo */
static int same_file(const BY_HANDLE_FILE_INFORMATION *a, const BY_HANDLE_FILE_INFORMATION *b) {
    return a->dwVolumeSerialNumber == b->dwVolumeSerialNumber &&
        a->nFileIndexHigh == b->nFileIndexHigh && a->nFileIndexLow == b->nFileIndexLow;
}
static int trusted(PSID sid, PSID user, PSID system, PSID admins) {
    return sid != NULL && IsValidSid(sid) &&
        (EqualSid(sid, user) || EqualSid(sid, system) || EqualSid(sid, admins));
}
static int protect(const wchar_t *path, int directory) {
    HANDLE token = NULL, file = INVALID_HANDLE_VALUE, again = INVALID_HANDLE_VALUE;
    TOKEN_USER *user = NULL;
    DWORD needed = 0, result, system_size = SECURITY_MAX_SID_SIZE, admin_size = SECURITY_MAX_SID_SIZE;
    union { DWORD aligned; BYTE bytes[SECURITY_MAX_SID_SIZE]; } system, admins;
    PSECURITY_DESCRIPTOR before = NULL, after = NULL;
    PSID owner = NULL, verified_owner = NULL, sids[3];
    PACL acl = NULL, verified_acl = NULL;
    EXPLICIT_ACCESSW entries[3];
    BY_HANDLE_FILE_INFORMATION identity, current;
    SECURITY_DESCRIPTOR_CONTROL control;
    ACL_SIZE_INFORMATION acl_info;
    DWORD revision, index;
    int ok = 0, user_access = 0;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) goto done;
    (void)GetTokenInformation(token, TokenUser, NULL, 0, &needed);
    if (!needed || needed > 65536) goto done;
    user = (TOKEN_USER *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, needed);
    if (!user || !GetTokenInformation(token, TokenUser, user, needed, &needed) || !IsValidSid(user->User.Sid)) goto done;
    if (!CreateWellKnownSid(WinLocalSystemSid, NULL, system.bytes, &system_size) ||
        !CreateWellKnownSid(WinBuiltinAdministratorsSid, NULL, admins.bytes, &admin_size)) goto done;
    file = CreateFileW(path, READ_CONTROL | WRITE_DAC | WRITE_OWNER,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT | (directory ? FILE_FLAG_BACKUP_SEMANTICS : 0), NULL);
    if (file == INVALID_HANDLE_VALUE || GetFileType(file) != FILE_TYPE_DISK || !GetFileInformationByHandle(file, &identity) ||
        (identity.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
        !!(identity.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != directory || (!directory && identity.nNumberOfLinks != 1)) goto done;
    if (GetSecurityInfo(file, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION, &owner, NULL, NULL, NULL, &before) != ERROR_SUCCESS ||
        !trusted(owner, user->User.Sid, system.bytes, admins.bytes)) goto done;
    ZeroMemory(entries, sizeof(entries));
    sids[0] = user->User.Sid; sids[1] = system.bytes; sids[2] = admins.bytes;
    for (index = 0; index < 3; index++) {
        entries[index].grfAccessPermissions = FILE_ALL_ACCESS;
        entries[index].grfAccessMode = SET_ACCESS;
        entries[index].grfInheritance = directory ? SUB_CONTAINERS_AND_OBJECTS_INHERIT : NO_INHERITANCE;
        entries[index].Trustee.TrusteeForm = TRUSTEE_IS_SID;
        entries[index].Trustee.TrusteeType = TRUSTEE_IS_UNKNOWN;
        entries[index].Trustee.ptstrName = (LPWSTR)sids[index];
    }
    if (SetEntriesInAclW(3, entries, NULL, &acl) != ERROR_SUCCESS || acl == NULL) goto done;
    result = SetSecurityInfo(file, SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
        user->User.Sid, NULL, acl, NULL);
    if (result != ERROR_SUCCESS ||
        GetSecurityInfo(file, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &verified_owner, NULL, &verified_acl, NULL, &after) != ERROR_SUCCESS || verified_acl == NULL ||
        verified_owner == NULL || !IsValidSid(verified_owner) || !EqualSid(verified_owner, user->User.Sid) || !GetSecurityDescriptorControl(after, &control, &revision) ||
        !(control & SE_DACL_PROTECTED) || !GetAclInformation(verified_acl, &acl_info, sizeof(acl_info), AclSizeInformation) ||
        acl_info.AceCount > 8) goto done;
    for (index = 0; index < acl_info.AceCount; index++) {
        void *raw = NULL;
        ACCESS_ALLOWED_ACE *ace;
        PSID sid;
        if (!GetAce(verified_acl, index, &raw) || ((ACE_HEADER *)raw)->AceType != ACCESS_ALLOWED_ACE_TYPE) goto done;
        ace = (ACCESS_ALLOWED_ACE *)raw; sid = (PSID)&ace->SidStart;
        if (!trusted(sid, user->User.Sid, system.bytes, admins.bytes)) goto done;
        if (EqualSid(sid, user->User.Sid) && (ace->Mask & FILE_ALL_ACCESS) == FILE_ALL_ACCESS && !(ace->Header.AceFlags & INHERIT_ONLY_ACE)) user_access = 1;
    }
    again = CreateFileW(path, FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        NULL, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | (directory ? FILE_FLAG_BACKUP_SEMANTICS : 0), NULL);
    if (!user_access || again == INVALID_HANDLE_VALUE || !GetFileInformationByHandle(again, &current) || !same_file(&identity, &current) ||
        (current.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) goto done;
    ok = 1;
done:
    if (again != INVALID_HANDLE_VALUE) CloseHandle(again);
    if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
    if (token != NULL) CloseHandle(token);
    if (user != NULL) HeapFree(GetProcessHeap(), 0, user);
    if (before != NULL) LocalFree(before);
    if (after != NULL) LocalFree(after);
    if (acl != NULL) LocalFree(acl);
    return ok;
}
int wmain(int argc, wchar_t **argv) {
    int directory, ok;
    if (argc != 3 || !argv[1][0] || wcslen(argv[1]) > 32767 ||
        (wcscmp(argv[2], L"directory") != 0 && wcscmp(argv[2], L"file") != 0)) return 2;
    directory = wcscmp(argv[2], L"directory") == 0;
    ok = protect(argv[1], directory);
    puts(ok ? "{\"ok\":true}" : "{\"ok\":false}");
    return ok ? 0 : 2;
}
