#!/usr/bin/env ruby
# Regenerates Lumen.xcodeproj from the files on disk.   gem install xcodeproj && ruby scripts/make-xcodeproj.rb
# One multiplatform app target (iPhone, iPad, Mac) that compiles the shared core and the SwiftUI app together.
require 'xcodeproj'
require 'fileutils'

root = File.expand_path('..', __dir__)
path = File.join(root, 'Lumen.xcodeproj')
FileUtils.rm_rf(path)
project = Xcodeproj::Project.new(path)
target = project.new_target(:application, 'Lumen', :ios, '16.0')
# The generator links one specific iOS SDK's Foundation.framework by path. Swift links system
# frameworks automatically, and that path would be wrong for macOS builds and other Xcode versions.
target.frameworks_build_phase.files.to_a.each { |bf| ref = bf.file_ref; target.frameworks_build_phase.remove_build_file(bf); ref&.remove_from_project }
project.frameworks_group.remove_from_project if project.frameworks_group.children.empty? || project.frameworks_group.recursive_children.none? { |c| c.is_a?(Xcodeproj::Project::Object::PBXFileReference) }

core = project.main_group.new_group('LumenCore', 'Sources/LumenCore')
app = project.main_group.new_group('Lumen', 'Lumen')
Dir[File.join(root, 'Sources/LumenCore/*.swift')].sort.each { |f| target.add_file_references([core.new_file(File.basename(f))]) }
Dir[File.join(root, 'Lumen/*.swift')].sort.each { |f| target.add_file_references([app.new_file(File.basename(f))]) }
target.add_resources([app.new_file('Assets.xcassets')])
app.new_file('Info.plist')
app.new_file('Lumen.entitlements')

settings = {
  'PRODUCT_NAME' => 'Lumen',
  'PRODUCT_BUNDLE_IDENTIFIER' => 'ca.lumen.app',
  'MARKETING_VERSION' => '1.0',
  'CURRENT_PROJECT_VERSION' => '1',
  'SWIFT_VERSION' => '5.0',
  # One target for every Apple platform we support.
  'SDKROOT' => 'auto',
  'SUPPORTED_PLATFORMS' => 'iphoneos iphonesimulator macosx',
  'SUPPORTS_MACCATALYST' => 'NO',
  'TARGETED_DEVICE_FAMILY' => '1,2',
  'IPHONEOS_DEPLOYMENT_TARGET' => '16.0',
  'MACOSX_DEPLOYMENT_TARGET' => '13.0',
  # Info.plist: generated, plus the keys in Lumen/Info.plist.
  'GENERATE_INFOPLIST_FILE' => 'YES',
  'INFOPLIST_FILE' => 'Lumen/Info.plist',
  'INFOPLIST_KEY_CFBundleDisplayName' => 'Lumen',
  'INFOPLIST_KEY_LSApplicationCategoryType' => 'public.app-category.education',
  'INFOPLIST_KEY_UILaunchScreen_Generation' => 'YES',
  'INFOPLIST_KEY_UIApplicationSceneManifest_Generation' => 'YES',
  'INFOPLIST_KEY_UISupportedInterfaceOrientations' => 'UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight',
  'INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad' => 'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight',
  'ASSETCATALOG_COMPILER_APPICON_NAME' => 'AppIcon',
  'ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME' => 'AccentColor',
  # Signing: automatic. Pick your team once under Signing & Capabilities for a real device;
  # the simulator and "My Mac" run without one.
  'CODE_SIGN_STYLE' => 'Automatic',
  'CODE_SIGN_IDENTITY[sdk=macosx*]' => '-',
  'CODE_SIGN_ENTITLEMENTS[sdk=macosx*]' => 'Lumen/Lumen.entitlements',
  'ENABLE_HARDENED_RUNTIME[sdk=macosx*]' => 'YES',
  'ENABLE_PREVIEWS' => 'YES',
  'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks',
  'LD_RUNPATH_SEARCH_PATHS[sdk=macosx*]' => '$(inherited) @executable_path/../Frameworks',
}
target.build_configurations.each { |c| c.build_settings.merge!(settings) }
project.build_configurations.each do |c|
  c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'
  c.build_settings['MACOSX_DEPLOYMENT_TARGET'] = '13.0'
  c.build_settings['SWIFT_VERSION'] = '5.0'
end
project.save

# A shared scheme, so `xcodebuild -scheme Lumen` works straight after cloning.
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(path, 'Lumen', true)
puts "wrote #{path} (#{target.source_build_phase.files.count} source files)"
