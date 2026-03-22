import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import Icon from '../ui/Icon';
import { AnnotationColors } from '../../constants/theme';

interface Annotation {
  id: string;
  type: string;
  text: string;
  position_after_section: number;
  generated_by: string;
}

interface PeekCardProps {
  annotation: Annotation;
  onTap: (annotation: Annotation) => void;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 8000;

export default function PeekCard({ annotation, onTap, onDismiss }: PeekCardProps) {
  const slideAnim = useRef(new Animated.Value(260)).current;

  useEffect(() => {
    // Slide in
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 10,
    }).start();

    // Auto-dismiss
    const timer = setTimeout(() => {
      Animated.timing(slideAnim, {
        toValue: 260,
        duration: 200,
        useNativeDriver: true,
      }).start(() => onDismiss());
    }, AUTO_DISMISS_MS);

    return () => clearTimeout(timer);
  }, [annotation.id]);

  const colors =
    AnnotationColors[annotation.type as keyof typeof AnnotationColors] ??
    AnnotationColors.reflection;

  return (
    <Animated.View
      style={[
        styles.card,
        { borderLeftColor: colors.accent, transform: [{ translateX: slideAnim }] },
      ]}
    >
      <TouchableOpacity
        style={styles.cardContent}
        onPress={() => onTap(annotation)}
        activeOpacity={0.8}
        accessibilityLabel={`${annotation.type}: ${annotation.text.slice(0, 40)}`}
      >
        <Text style={styles.type}>{annotation.type.replace('_', ' ')}</Text>
        <Text style={styles.text}>
          {annotation.text}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    right: 8,
    top: '40%',
    width: 300,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderLeftWidth: 4,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    zIndex: 95,
  },
  cardContent: {
    padding: 12,
  },
  type: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#6B7280',
    marginBottom: 4,
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
    color: '#1F2937',
  },
});
