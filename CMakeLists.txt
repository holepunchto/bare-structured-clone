cmake_minimum_required(VERSION 3.25)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)

project(bare_structured_clone C)

add_bare_module(bare_structured_clone)

target_sources(
  ${bare_structured_clone}
  PRIVATE
    binding.c
)
