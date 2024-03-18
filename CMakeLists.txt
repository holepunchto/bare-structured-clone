cmake_minimum_required(VERSION 3.25)

project(bare_structured_clone C)

include(bare)

add_bare_module(bare_structured_clone)

target_sources(
  ${bare_structured_clone}
  PRIVATE
    binding.c
)
