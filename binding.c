#include <assert.h>
#include <bare.h>
#include <js.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>

// Backing stores and external pointers are handed to JavaScript as opaque,
// single use tokens rather than as raw addresses. A serialized value is
// untrusted input: it round-trips through JavaScript and, between threads,
// through the wire format, so a handle must be neither forgeable nor an
// address disclosure. Tokens are only meaningful within the process that
// minted them, which is also the only place a transfer is valid.

#define BARE_STRUCTURED_CLONE_BUCKETS 1024

enum {
  bare_structured_clone_arraybuffer = 1,
  bare_structured_clone_sharedarraybuffer,
  bare_structured_clone_external
};

typedef struct bare_structured_clone_context_s bare_structured_clone_context_t;
typedef struct bare_structured_clone_entry_s bare_structured_clone_entry_t;

struct bare_structured_clone_context_s {
  js_env_t *env;
};

struct bare_structured_clone_entry_s {
  uint64_t token;
  int type;
  void *value;
  bool retained;

  // The instance that minted the entry, for as long as that instance is
  // alive. Releasing a backing store needs a live environment, and a handle
  // can outlive the instance it came from.
  bare_structured_clone_context_t *owner;

  bare_structured_clone_entry_t *next;
};

static bare_structured_clone_entry_t *bare_structured_clone__buckets[BARE_STRUCTURED_CLONE_BUCKETS];

static uv_once_t bare_structured_clone__guard = UV_ONCE_INIT;
static uv_mutex_t bare_structured_clone__lock;
static bool bare_structured_clone__ready;

static void
bare_structured_clone__on_setup(void) {
  bare_structured_clone__ready = uv_mutex_init(&bare_structured_clone__lock) == 0;
}

static inline bool
bare_structured_clone__setup(void) {
  uv_once(&bare_structured_clone__guard, bare_structured_clone__on_setup);

  return bare_structured_clone__ready;
}

static bare_structured_clone_entry_t *
bare_structured_clone__find(uint64_t token) {
  bare_structured_clone_entry_t *entry = bare_structured_clone__buckets[token & (BARE_STRUCTURED_CLONE_BUCKETS - 1)];

  while (entry && entry->token != token) {
    entry = entry->next;
  }

  return entry;
}

static bool
bare_structured_clone__insert(bare_structured_clone_context_t *owner, int type, void *value, uint64_t *result) {
  bare_structured_clone_entry_t *entry = malloc(sizeof(bare_structured_clone_entry_t));
  if (entry == NULL) return false;

  uint64_t token;

  do {
    if (uv_random(NULL, NULL, &token, sizeof(token), 0, NULL) < 0) {
      free(entry);

      return false;
    }
  } while (token == 0 || bare_structured_clone__find(token));

  entry->token = token;
  entry->type = type;
  entry->value = value;
  entry->retained = false;
  entry->owner = owner;

  size_t i = token & (BARE_STRUCTURED_CLONE_BUCKETS - 1);

  entry->next = bare_structured_clone__buckets[i];

  bare_structured_clone__buckets[i] = entry;

  *result = token;

  return true;
}

static void
bare_structured_clone__unlink(uint64_t token) {
  bare_structured_clone_entry_t **link = &bare_structured_clone__buckets[token & (BARE_STRUCTURED_CLONE_BUCKETS - 1)];

  while (*link) {
    if ((*link)->token == token) {
      *link = (*link)->next;

      return;
    }

    link = &(*link)->next;
  }
}

static bool
bare_structured_clone__take(uint64_t token, int type, void **result) {
  uv_mutex_lock(&bare_structured_clone__lock);

  bare_structured_clone_entry_t *entry = bare_structured_clone__find(token);

  bool taken = entry != NULL && entry->type == type;

  if (taken) {
    bare_structured_clone__unlink(token);

    *result = entry->value;

    free(entry);
  }

  uv_mutex_unlock(&bare_structured_clone__lock);

  return taken;
}

static bool
bare_structured_clone__collect(uint64_t token, int *type, void **value) {
  uv_mutex_lock(&bare_structured_clone__lock);

  bare_structured_clone_entry_t *entry = bare_structured_clone__find(token);

  bool collectable = entry != NULL && !entry->retained && entry->owner != NULL;

  if (collectable) {
    bare_structured_clone__unlink(token);

    *type = entry->type;
    *value = entry->value;

    free(entry);
  }

  uv_mutex_unlock(&bare_structured_clone__lock);

  return collectable;
}

static bool
bare_structured_clone__retain(uint64_t token) {
  uv_mutex_lock(&bare_structured_clone__lock);

  bare_structured_clone_entry_t *entry = bare_structured_clone__find(token);

  bool found = entry != NULL;

  if (found) entry->retained = true;

  uv_mutex_unlock(&bare_structured_clone__lock);

  return found;
}

static void
bare_structured_clone__release(js_env_t *env, int type, void *value) {
  if (type == bare_structured_clone_external) return;

  int err = js_release_arraybuffer_backing_store(env, (js_arraybuffer_backing_store_t *) value);
  assert(err == 0);
}

static void
bare_structured_clone__on_handle_finalize(js_env_t *env, void *data, void *finalize_hint) {
  (void) finalize_hint;

  uint64_t *token = (uint64_t *) data;

  int type;
  void *value;

  if (bare_structured_clone__collect(*token, &type, &value)) {
    bare_structured_clone__release(env, type, value);
  }

  free(token);
}

static void
bare_structured_clone__on_teardown(void *data) {
  bare_structured_clone_context_t *context = (bare_structured_clone_context_t *) data;

  uv_mutex_lock(&bare_structured_clone__lock);

  for (size_t i = 0; i < BARE_STRUCTURED_CLONE_BUCKETS; i++) {
    bare_structured_clone_entry_t **link = &bare_structured_clone__buckets[i];

    while (*link) {
      bare_structured_clone_entry_t *entry = *link;

      if (entry->owner != context) {
        link = &entry->next;
      } else if (entry->retained) {
        entry->owner = NULL;

        link = &entry->next;
      } else {
        *link = entry->next;

        bare_structured_clone__release(context->env, entry->type, entry->value);

        free(entry);
      }
    }
  }

  uv_mutex_unlock(&bare_structured_clone__lock);

  free(context);
}

static js_value_t *
bare_structured_clone__mint(js_env_t *env, bare_structured_clone_context_t *context, int type, void *value) {
  int err;

  uint64_t *token = malloc(sizeof(uint64_t));

  bool minted = false;

  if (token) {
    uv_mutex_lock(&bare_structured_clone__lock);

    minted = bare_structured_clone__insert(context, type, value, token);

    uv_mutex_unlock(&bare_structured_clone__lock);
  }

  if (!minted) {
    free(token);

    bare_structured_clone__release(env, type, value);

    err = js_throw_error(env, "INVALID_HANDLE", "Handle could not be allocated");
    assert(err == 0);

    return NULL;
  }

  js_value_t *result;

  uint64_t *data;
  err = js_create_arraybuffer(env, sizeof(uint64_t), (void **) &data, &result);

  if (err == 0) {
    *data = *token;

    err = js_add_finalizer(env, result, token, bare_structured_clone__on_handle_finalize, NULL, NULL);
  }

  if (err < 0) {
    int type;
    void *value;

    if (bare_structured_clone__collect(*token, &type, &value)) {
      bare_structured_clone__release(env, type, value);
    }

    free(token);

    return NULL;
  }

  return result;
}

static bool
bare_structured_clone__token(js_env_t *env, js_value_t *value, uint64_t *result) {
  int err;

  bool is_arraybuffer;
  err = js_is_arraybuffer(env, value, &is_arraybuffer);
  assert(err == 0);

  bool is_detached = false;

  if (is_arraybuffer) {
    err = js_is_detached_arraybuffer(env, value, &is_detached);
    assert(err == 0);
  }

  if (!is_arraybuffer || is_detached) {
    err = js_throw_error(env, "INVALID_HANDLE", "Handle must be an ArrayBuffer");
    assert(err == 0);

    return false;
  }

  void *data;
  size_t len;
  err = js_get_arraybuffer_info(env, value, &data, &len);
  assert(err == 0);

  if (len != sizeof(uint64_t)) {
    err = js_throw_error(env, "INVALID_HANDLE", "Handle is malformed");
    assert(err == 0);

    return false;
  }

  memcpy(result, data, sizeof(uint64_t));

  return true;
}

static bool
bare_structured_clone__argument(js_env_t *env, js_callback_info_t *info, js_value_t **result, bare_structured_clone_context_t **context) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];
  void *data;

  err = js_get_callback_info(env, info, &argc, argv, NULL, &data);
  assert(err == 0);

  if (argc < 1) {
    err = js_throw_type_error(env, "INVALID_ARGUMENT", "Expected 1 argument");
    assert(err == 0);

    return false;
  }

  *result = argv[0];

  if (context) *context = (bare_structured_clone_context_t *) data;

  return true;
}

static js_value_t *
bare_structured_clone_get_arraybuffer_backing_store(js_env_t *env, js_callback_info_t *info) {
  int err;

  js_value_t *value;
  bare_structured_clone_context_t *context;
  if (!bare_structured_clone__argument(env, info, &value, &context)) return NULL;

  bool is_arraybuffer;
  err = js_is_arraybuffer(env, value, &is_arraybuffer);
  assert(err == 0);

  if (!is_arraybuffer) {
    err = js_throw_type_error(env, "INVALID_TYPE", "Value must be an ArrayBuffer");
    assert(err == 0);

    return NULL;
  }

  bool is_detached;
  err = js_is_detached_arraybuffer(env, value, &is_detached);
  assert(err == 0);

  if (is_detached) {
    err = js_throw_error(env, "ALREADY_TRANSFERRED", "ArrayBuffer is detached");
    assert(err == 0);

    return NULL;
  }

  js_arraybuffer_backing_store_t *backing_store;
  err = js_get_arraybuffer_backing_store(env, value, &backing_store);
  assert(err == 0);

  return bare_structured_clone__mint(env, context, bare_structured_clone_arraybuffer, backing_store);
}

static js_value_t *
bare_structured_clone_get_sharedarraybuffer_backing_store(js_env_t *env, js_callback_info_t *info) {
  int err;

  js_value_t *value;
  bare_structured_clone_context_t *context;
  if (!bare_structured_clone__argument(env, info, &value, &context)) return NULL;

  bool is_sharedarraybuffer;
  err = js_is_sharedarraybuffer(env, value, &is_sharedarraybuffer);
  assert(err == 0);

  if (!is_sharedarraybuffer) {
    err = js_throw_type_error(env, "INVALID_TYPE", "Value must be a SharedArrayBuffer");
    assert(err == 0);

    return NULL;
  }

  js_arraybuffer_backing_store_t *backing_store;
  err = js_get_sharedarraybuffer_backing_store(env, value, &backing_store);
  assert(err == 0);

  return bare_structured_clone__mint(env, context, bare_structured_clone_sharedarraybuffer, backing_store);
}

static js_value_t *
bare_structured_clone_create_arraybuffer(js_env_t *env, js_callback_info_t *info) {
  int err;

  js_value_t *value;
  if (!bare_structured_clone__argument(env, info, &value, NULL)) return NULL;

  uint64_t token;
  if (!bare_structured_clone__token(env, value, &token)) return NULL;

  void *backing_store;

  if (!bare_structured_clone__take(token, bare_structured_clone_arraybuffer, &backing_store)) {
    err = js_throw_error(env, "INVALID_HANDLE", "ArrayBuffer backing store is unknown");
    assert(err == 0);

    return NULL;
  }

  js_value_t *result;
  err = js_create_arraybuffer_with_backing_store(
    env,
    (js_arraybuffer_backing_store_t *) backing_store,
    NULL,
    NULL,
    &result
  );

  js_release_arraybuffer_backing_store(env, (js_arraybuffer_backing_store_t *) backing_store);

  if (err < 0) return NULL;

  return result;
}

static js_value_t *
bare_structured_clone_create_sharedarraybuffer(js_env_t *env, js_callback_info_t *info) {
  int err;

  js_value_t *value;
  if (!bare_structured_clone__argument(env, info, &value, NULL)) return NULL;

  uint64_t token;
  if (!bare_structured_clone__token(env, value, &token)) return NULL;

  void *backing_store;

  if (!bare_structured_clone__take(token, bare_structured_clone_sharedarraybuffer, &backing_store)) {
    err = js_throw_error(env, "INVALID_HANDLE", "SharedArrayBuffer backing store is unknown");
    assert(err == 0);

    return NULL;
  }

  js_value_t *result;
  err = js_create_sharedarraybuffer_with_backing_store(
    env,
    (js_arraybuffer_backing_store_t *) backing_store,
    NULL,
    NULL,
    &result
  );

  js_release_arraybuffer_backing_store(env, (js_arraybuffer_backing_store_t *) backing_store);

  if (err < 0) return NULL;

  return result;
}

static js_value_t *
bare_structured_clone_detach_arraybuffer(js_env_t *env, js_callback_info_t *info) {
  int err;

  js_value_t *value;
  if (!bare_structured_clone__argument(env, info, &value, NULL)) return NULL;

  bool is_arraybuffer;
  err = js_is_arraybuffer(env, value, &is_arraybuffer);
  assert(err == 0);

  if (!is_arraybuffer) {
    err = js_throw_type_error(env, "INVALID_TYPE", "Value must be an ArrayBuffer");
    assert(err == 0);

    return NULL;
  }

  bool is_detached;
  err = js_is_detached_arraybuffer(env, value, &is_detached);
  assert(err == 0);

  if (is_detached) return NULL;

  err = js_detach_arraybuffer(env, value);
  assert(err == 0);

  return NULL;
}

static js_value_t *
bare_structured_clone_get_external(js_env_t *env, js_callback_info_t *info) {
  int err;

  js_value_t *value;
  bare_structured_clone_context_t *context;
  if (!bare_structured_clone__argument(env, info, &value, &context)) return NULL;

  bool is_external;
  err = js_is_external(env, value, &is_external);
  assert(err == 0);

  if (!is_external) {
    err = js_throw_type_error(env, "INVALID_TYPE", "Value must be an external");
    assert(err == 0);

    return NULL;
  }

  void *data;
  err = js_get_value_external(env, value, &data);
  assert(err == 0);

  return bare_structured_clone__mint(env, context, bare_structured_clone_external, data);
}

static js_value_t *
bare_structured_clone_create_external(js_env_t *env, js_callback_info_t *info) {
  int err;

  js_value_t *value;
  if (!bare_structured_clone__argument(env, info, &value, NULL)) return NULL;

  uint64_t token;
  if (!bare_structured_clone__token(env, value, &token)) return NULL;

  void *data;

  if (!bare_structured_clone__take(token, bare_structured_clone_external, &data)) {
    err = js_throw_error(env, "INVALID_HANDLE", "External pointer is unknown");
    assert(err == 0);

    return NULL;
  }

  if (data == NULL) {
    err = js_throw_error(env, "INVALID_HANDLE", "External pointer is unset");
    assert(err == 0);

    return NULL;
  }

  js_value_t *result;
  err = js_create_external(env, data, NULL, NULL, &result);
  if (err < 0) return NULL;

  return result;
}

static js_value_t *
bare_structured_clone_retain_handle(js_env_t *env, js_callback_info_t *info) {
  int err;

  js_value_t *value;
  if (!bare_structured_clone__argument(env, info, &value, NULL)) return NULL;

  uint64_t token;
  if (!bare_structured_clone__token(env, value, &token)) return NULL;

  if (!bare_structured_clone__retain(token)) {
    err = js_throw_error(env, "INVALID_HANDLE", "Handle is unknown");
    assert(err == 0);
  }

  return NULL;
}

static js_value_t *
bare_structured_clone_exports(js_env_t *env, js_value_t *exports) {
  int err;

  if (!bare_structured_clone__setup()) {
    err = js_throw_error(env, "INVALID_HANDLE", "Handle registry is unavailable");
    assert(err == 0);

    return NULL;
  }

  bare_structured_clone_context_t *context = malloc(sizeof(bare_structured_clone_context_t));

  if (context == NULL) {
    err = js_throw_error(env, "INVALID_HANDLE", "Addon context could not be allocated");
    assert(err == 0);

    return NULL;
  }

  context->env = env;

  err = js_add_teardown_callback(env, bare_structured_clone__on_teardown, context);

  if (err < 0) {
    free(context);

    return NULL;
  }

#define V(name, fn) \
  { \
    js_value_t *val; \
    err = js_create_function(env, name, -1, fn, context, &val); \
    assert(err == 0); \
    err = js_set_named_property(env, exports, name, val); \
    assert(err == 0); \
  }

  V("getArrayBufferBackingStore", bare_structured_clone_get_arraybuffer_backing_store)
  V("getSharedArrayBufferBackingStore", bare_structured_clone_get_sharedarraybuffer_backing_store)
  V("createArrayBuffer", bare_structured_clone_create_arraybuffer)
  V("createSharedArrayBuffer", bare_structured_clone_create_sharedarraybuffer)
  V("detachArrayBuffer", bare_structured_clone_detach_arraybuffer)
  V("getExternal", bare_structured_clone_get_external)
  V("createExternal", bare_structured_clone_create_external)
  V("retainHandle", bare_structured_clone_retain_handle)
#undef V

  return exports;
}

BARE_MODULE(bare_structured_clone, bare_structured_clone_exports)
