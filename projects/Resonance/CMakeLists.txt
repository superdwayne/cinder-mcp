cmake_minimum_required(VERSION 3.16 FATAL_ERROR)
project(Resonance)
if(DEFINED ENV{CINDER_PATH})
    set(CINDER_PATH $ENV{CINDER_PATH})
else()
    set(CINDER_PATH "/Users/dwayne/Downloads/cinder_0.9.3_mac")
endif()
get_filename_component(CINDER_PATH "${CINDER_PATH}" ABSOLUTE)
include("${CINDER_PATH}/proj/cmake/modules/cinderMakeApp.cmake")
ci_make_app(
    SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/src/ResonanceApp.cpp
    INCLUDES ${CMAKE_CURRENT_SOURCE_DIR}/include
    CINDER_PATH ${CINDER_PATH}
)
