import React from 'react';
import { View, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { AnnotationColors } from '../../constants/theme';

interface Annotation {
  id: string;
  type: string;
  text: string;
  position_after_section: number;
  generated_by: string;
}

interface AnnotationRailProps {
  annotations: Annotation[];
  totalSections: number;
  scrollProgress: number;
  onDotTap: (annotation: Annotation) => void;
}

const RAIL_TOP = 100; // below toolbar
const DOT_SIZE = 10;

export default function AnnotationRail({
  annotations,
  totalSections,
  scrollProgress,
  onDotTap,
}: AnnotationRailProps) {
  const screenHeight = Dimensions.get('window').height;
  const railHeight = screenHeight - RAIL_TOP - 80; // leave room for FAB

  if (annotations.length === 0 || totalSections === 0) return null;

  return (
    <View style={[styles.rail, { top: RAIL_TOP, height: railHeight }]}>
      {annotations.map((ann) => {
        const ratio = ann.position_after_section / totalSections;
        const topOffset = ratio * railHeight;
        const colors =
          AnnotationColors[ann.type as keyof typeof AnnotationColors] ??
          AnnotationColors.reflection;

        return (
          <TouchableOpacity
            key={ann.id}
            style={[
              styles.dot,
              {
                top: topOffset - DOT_SIZE / 2,
                backgroundColor: colors.accent,
              },
            ]}
            onPress={() => onDotTap(ann)}
            accessibilityLabel={`${ann.type} annotation`}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          />
        );
      })}

      {/* Scroll indicator line */}
      <View
        style={[
          styles.scrollIndicator,
          { top: scrollProgress * railHeight },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: 'absolute',
    right: 4,
    width: 16,
    zIndex: 80,
  },
  dot: {
    position: 'absolute',
    right: 3,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  scrollIndicator: {
    position: 'absolute',
    right: 0,
    width: 16,
    height: 2,
    backgroundColor: 'rgba(99, 102, 241, 0.6)',
  },
});
