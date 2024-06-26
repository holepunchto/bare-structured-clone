#include <assert.h>
#include <bare.h>
#include <js.h>
#include <stddef.h>
#include <stdint.h>

static js_value_t *
bare_structured_clone_get_arraybuffer_backing_store (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  js_arraybuffer_backing_store_t *backing_store;
  err = js_get_arraybuffer_backing_store(env, argv[0], &backing_store);
  assert(err == 0);

  js_value_t *result;

  uintptr_t *handle;
  err = js_create_arraybuffer(env, sizeof(uintptr_t), (void **) &handle, &result);
  assert(err == 0);

  *handle = (uintptr_t) backing_store;

  return result;
}

static js_value_t *
bare_structured_clone_get_sharedarraybuffer_backing_store (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  js_arraybuffer_backing_store_t *backing_store;
  err = js_get_sharedarraybuffer_backing_store(env, argv[0], &backing_store);
  assert(err == 0);

  js_value_t *result;

  uintptr_t *handle;
  err = js_create_arraybuffer(env, sizeof(uintptr_t), (void **) &handle, &result);
  assert(err == 0);

  *handle = (uintptr_t) backing_store;

  return result;
}

static js_value_t *
bare_structured_clone_create_arraybuffer (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  js_arraybuffer_backing_store_t **backing_store;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &backing_store, NULL);
  assert(err == 0);

  if (*backing_store == NULL) {
    js_throw_error(env, NULL, "ArrayBuffer backing store is unset");
    return NULL;
  }

  js_value_t *result;
  err = js_create_arraybuffer_with_backing_store(env, *backing_store, NULL, NULL, &result);
  assert(err == 0);

  err = js_release_arraybuffer_backing_store(env, *backing_store);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_structured_clone_create_sharedarraybuffer (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  js_arraybuffer_backing_store_t **backing_store;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &backing_store, NULL);
  assert(err == 0);

  if (*backing_store == NULL) {
    js_throw_error(env, NULL, "SharedArrayBuffer backing store is unset");
    return NULL;
  }

  js_value_t *result;
  err = js_create_sharedarraybuffer_with_backing_store(env, *backing_store, NULL, NULL, &result);
  assert(err == 0);

  err = js_release_arraybuffer_backing_store(env, *backing_store);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_structured_clone_detach_arraybuffer (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  err = js_detach_arraybuffer(env, argv[0]);
  assert(err == 0);

  return NULL;
}

static js_value_t *
bare_structured_clone_get_external (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  void *data;
  err = js_get_value_external(env, argv[0], &data);
  assert(err == 0);

  js_value_t *result;

  uintptr_t *handle;
  err = js_create_arraybuffer(env, sizeof(uintptr_t), (void **) &handle, &result);
  assert(err == 0);

  *handle = (uintptr_t) data;

  return result;
}

static js_value_t *
bare_structured_clone_create_external (js_env_t *env, js_callback_info_t *info) {
  int err;

  size_t argc = 1;
  js_value_t *argv[1];

  err = js_get_callback_info(env, info, &argc, argv, NULL, NULL);
  assert(err == 0);

  assert(argc == 1);

  void **data;
  err = js_get_arraybuffer_info(env, argv[0], (void **) &data, NULL);
  assert(err == 0);

  js_value_t *result;
  err = js_create_external(env, *data, NULL, NULL, &result);
  assert(err == 0);

  return result;
}

static js_value_t *
bare_structured_clone_exports (js_env_t *env, js_value_t *exports) {
  int err;

#define V(name, fn) \
  { \
    js_value_t *val; \
    err = js_create_function(env, name, -1, fn, NULL, &val); \
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
#undef V

  return exports;
}

BARE_MODULE(bare_structured_clone, bare_structured_clone_exports)
