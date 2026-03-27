cmake_minimum_required(VERSION 3.16 FATAL_ERROR)
set(CMAKE_VERBOSE_MAKEFILE ON)

project(BlockBounce)

# Cinder path
if(DEFINED ENV{CINDER_PATH})
    set(CINDER_PATH $ENV{CINDER_PATH})
else()
    set(CINDER_PATH "/Users/dwayne/Downloads/cinder_0.9.3_mac")
endif()

get_filename_component(CINDER_PATH "${CINDER_PATH}" ABSOLUTE)

# Find OpenCV
find_package(OpenCV REQUIRED)

# Include Box2D block
set(BOX2D_BLOCK_PATH "${CINDER_PATH}/blocks/Box2D")

# Gather Box2D sources
file(GLOB_RECURSE BOX2D_SOURCES "${BOX2D_BLOCK_PATH}/src/*.cpp")

include("${CINDER_PATH}/proj/cmake/modules/cinderMakeApp.cmake")

ci_make_app(
    SOURCES     ${CMAKE_CURRENT_SOURCE_DIR}/src/BlockBounceApp.cpp
                ${BOX2D_SOURCES}
    INCLUDES    ${CMAKE_CURRENT_SOURCE_DIR}/include
                ${BOX2D_BLOCK_PATH}/src
                ${OpenCV_INCLUDE_DIRS}
                "${CINDER_PATH}/blocks/OSC/src"
    CINDER_PATH ${CINDER_PATH}
    LIBRARIES   ${OpenCV_LIBS}
)

# Copy assets to build directory
file(COPY ${CMAKE_CURRENT_SOURCE_DIR}/assets DESTINATION ${CMAKE_CURRENT_BINARY_DIR})
